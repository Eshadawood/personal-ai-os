import { and, desc, eq, gt } from "drizzle-orm";
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

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
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
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
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
  await db.insert(sessions).values({ userId, tokenHash, expiresAt });
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
