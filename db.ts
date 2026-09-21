import { and, desc, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  activityEvents,
  conversations,
  goals,
  memories,
  messages,
  sessions,
  tasks,
  users,
  type InsertUser,
} from "./drizzle/schema";
import { ENV } from "./_core/env";
import { hashSessionToken } from "./auth";

let _db: ReturnType<typeof drizzle> | null = null;

const TRANSIENT_DATABASE_ERRORS = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_CON_COUNT_ERROR",
]);

function isTransientDatabaseError(error: unknown) {
  const code = (error as { code?: string })?.code;
  return typeof code === "string" && TRANSIENT_DATABASE_ERRORS.has(code);
}

async function withDatabaseRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === 2) throw error;
      const delayMs = 250 * (attempt + 1);
      console.warn(`[Database] Transient ${label} failure; retrying in ${delayMs}ms`, error);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      // Hosted MySQL providers such as TiDB Cloud reject plaintext clients.
      // Keep local development unchanged, but use certificate-verified TLS in
      // production. DATABASE_SSL can opt into TLS for hosted non-production.
      const tlsEnabled = ENV.isProduction || process.env.DATABASE_SSL === "true";
      const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
      _db = drizzle({
        connection: {
          uri: ENV.databaseUrl,
          connectTimeout: 30_000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
          waitForConnections: true,
          connectionLimit: 2,
          maxIdle: 2,
          ...(tlsEnabled ? { ssl: { rejectUnauthorized } } : {}),
        },
      });
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function getDatabaseHealth(): Promise<"connected" | "not_configured" | "unavailable"> {
  const db = await getDb();
  if (!db) return "not_configured";
  try {
    await db.execute(sql`SELECT 1`);
    return "connected";
  } catch (error) {
    console.error("[Database] Health check failed", error);
    return "unavailable";
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= new Date();
  updateSet.lastSignedIn ??= new Date();
  await withDatabaseRetry(
    () => db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet }),
    "user upsert",
  );
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await withDatabaseRetry(
    () => db.select().from(users).where(eq(users.openId, openId)).limit(1),
    "user lookup",
  );
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1))[0];
}

export async function getUserBySessionToken(token: string) {
  const db = await getDb();
  if (!db || !token) return undefined;
  const rows = await db.select({ user: users }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return rows[0]?.user;
}

export async function createSession(userId: number, tokenHash: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured.");
  await withDatabaseRetry(
    () => db.insert(sessions).values({ userId, tokenHash, expiresAt }).onDuplicateKeyUpdate({ set: { tokenHash } }),
    "session insert",
  );
}

export async function revokeSession(token: string) {
  const db = await getDb();
  if (db && token) await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

export async function getDashboardData(userId: number) {
  const db = await getDb();
  if (!db) return { goals: [], tasks: [], memories: [], activity: [] };
  const [userGoals, userTasks, userMemories, userActivity] = await Promise.all([
    db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.updatedAt)),
    db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(desc(tasks.updatedAt)),
    db.select().from(memories).where(eq(memories.userId, userId)).orderBy(desc(memories.updatedAt)),
    db.select().from(activityEvents).where(eq(activityEvents.userId, userId)).orderBy(desc(activityEvents.createdAt)).limit(20),
  ]);
  return { goals: userGoals, tasks: userTasks, memories: userMemories, activity: userActivity };
}

export async function recordActivity(input: {
  userId: number;
  eventType: string;
  title: string;
  description?: string;
  agent?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(activityEvents).values(input);
}

export async function updateGoalProgress(userId: number, goalId: number) {
  const db = await getDb();
  if (!db) return;
  const related = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.goalId, goalId)));
  const completed = related.filter(task => task.status === "completed").length;
  const progress = related.length ? Math.round((completed / related.length) * 100) : 0;
  await db.update(goals).set({ progress, status: progress === 100 ? "completed" : "active" }).where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
}

export async function saveConversationMessage(input: {
  userId: number;
  conversationId?: number;
  title: string;
  role: "user" | "assistant" | "system";
  content: string;
}) {
  const db = await getDb();
  if (!db) return;
  let conversationId = input.conversationId;
  if (!conversationId) {
    const created = await db.insert(conversations).values({ userId: input.userId, title: input.title }).$returningId();
    const createdId = created[0]?.id;
    if (typeof createdId !== "number" || !Number.isInteger(createdId) || createdId <= 0) {
      throw new Error("Conversation insert did not return a valid database ID.");
    }
    conversationId = createdId;
  }
  await db.insert(messages).values({ userId: input.userId, conversationId, role: input.role, content: input.content });
  return conversationId;
}
