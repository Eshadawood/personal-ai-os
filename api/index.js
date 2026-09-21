// server/app.ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// routers.ts
import { TRPCError as TRPCError2 } from "@trpc/server";
import { and as and2, desc as desc2, eq as eq2 } from "drizzle-orm";
import { z } from "zod";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: text("passwordHash"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var goals = mysqlTable("goals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["active", "completed", "paused"]).default("active").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium").notNull(),
  progress: int("progress").default(0).notNull(),
  deadline: timestamp("deadline"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  goalId: int("goalId"),
  title: text("title").notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["todo", "in_progress", "completed", "failed"]).default("todo").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium").notNull(),
  agent: varchar("agent", { length: 80 }).default("Task Agent").notNull(),
  dueDate: timestamp("dueDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var memories = mysqlTable("memories", { id: int("id").autoincrement().primaryKey(), userId: int("userId").notNull(), category: varchar("category", { length: 48 }).notNull(), content: text("content").notNull(), importance: int("importance").default(70).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull() });
var activityEvents = mysqlTable("activityEvents", { id: int("id").autoincrement().primaryKey(), userId: int("userId").notNull(), eventType: varchar("eventType", { length: 48 }).notNull(), title: text("title").notNull(), description: text("description"), agent: varchar("agent", { length: 80 }), createdAt: timestamp("createdAt").defaultNow().notNull() });
var conversations = mysqlTable("conversations", { id: int("id").autoincrement().primaryKey(), userId: int("userId").notNull(), title: text("title").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull() });
var messages = mysqlTable("messages", { id: int("id").autoincrement().primaryKey(), conversationId: int("conversationId").notNull(), userId: int("userId").notNull(), role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(), content: text("content").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull() });

// _core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-20b"
};

// _core/llm.ts
var ensureArray = (value) => Array.isArray(value) ? value : [value];
var normalizeContentPart = (part) => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") {
    return part;
  }
  if (part.type === "image_url") {
    return part;
  }
  if (part.type === "file_url") {
    return part;
  }
  throw new Error("Unsupported message content part");
};
var normalizeMessage = (message) => {
  const { role, name, tool_call_id } = message;
  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content).map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\n");
    return {
      role,
      name,
      tool_call_id,
      content
    };
  }
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text
    };
  }
  return {
    role,
    name,
    content: contentParts
  };
};
var normalizeToolChoice = (toolChoice, tools) => {
  if (!toolChoice) return void 0;
  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }
  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return {
      type: "function",
      function: { name: tools[0].function.name }
    };
  }
  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name }
    };
  }
  return toolChoice;
};
var GROQ_API_URL = "https://api.groq.com/openai/v1";
var resolveApiUrl = () => `${GROQ_API_URL}/chat/completions`;
var assertApiKey = () => {
  if (!ENV.groqApiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }
};
var normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema
}) => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return void 0;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...typeof schema.strict === "boolean" ? { strict: schema.strict } : {}
    }
  };
};
var RETRY_MAX_RETRIES = 4;
var RETRY_BASE_DELAY_MS = 500;
var RETRY_MAX_DELAY_MS = 3e4;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var parseRetryAfter = (value) => {
  if (!value) return void 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
  const at = Date.parse(value);
  return Number.isNaN(at) ? void 0 : Math.max(0, at - Date.now());
};
var computeBackoffDelay = (attempt, retryAfterMs) => {
  const cap = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  const jittered = cap / 2 + Math.random() * (cap / 2);
  return Math.min(Math.max(jittered, retryAfterMs ?? 0), RETRY_MAX_DELAY_MS);
};
var fetchWithBackoff = async (url, init) => {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || attempt === RETRY_MAX_RETRIES) {
        return response;
      }
      const retryAfterMs = parseRetryAfter(
        response.headers.get("retry-after")
      );
      try {
        await response.body?.cancel();
      } catch {
      }
      console.warn(
        `LLM request retry ${attempt + 1}/${RETRY_MAX_RETRIES} after status ${response.status}`
      );
      await sleep(computeBackoffDelay(attempt, retryAfterMs));
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_MAX_RETRIES) throw error;
      console.warn(
        `LLM request retry ${attempt + 1}/${RETRY_MAX_RETRIES} after network error`
      );
      await sleep(computeBackoffDelay(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM request failed after exhausting retries");
};
async function parseJsonResponse(response, fallbackMessage) {
  const body = await response.text();
  if (!body) throw new Error(fallbackMessage);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(fallbackMessage);
  }
}
async function invokeLLM(params) {
  assertApiKey();
  const {
    messages: messages2,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    model,
    thinking,
    reasoning,
    maxTokens,
    max_tokens
  } = params;
  const payload = {
    messages: messages2.map(normalizeMessage)
  };
  payload.model = model || ENV.groqModel;
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }
  const resolvedMaxTokens = max_tokens ?? maxTokens;
  if (typeof resolvedMaxTokens === "number") {
    payload.max_tokens = resolvedMaxTokens;
  }
  if (thinking) {
    payload.thinking = thinking;
  }
  if (reasoning) {
    payload.reasoning = reasoning;
  }
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema
  });
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }
  const response = await fetchWithBackoff(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.groqApiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} \u2013 ${errorText}`
    );
  }
  return parseJsonResponse(response, "The AI service returned an invalid response.");
}

// shared/const.ts
var COOKIE_NAME = "manus-session";
var UNAUTHED_ERR_MSG = "You must be signed in to use this workspace.";
var NOT_ADMIN_ERR_MSG = "Administrator access is required.";

// _core/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// db.ts
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// auth.ts
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
var scrypt = promisify(scryptCallback);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  const [, salt, digest] = encoded.split("$");
  if (!salt || !digest) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function newSessionToken() {
  return randomBytes(32).toString("base64url");
}
function hashSessionToken(token) {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update(token).digest("hex");
}

// db.ts
var _db = null;
var TRANSIENT_DATABASE_ERRORS = /* @__PURE__ */ new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_CON_COUNT_ERROR"
]);
function isTransientDatabaseError(error) {
  const code = error?.code;
  return typeof code === "string" && TRANSIENT_DATABASE_ERRORS.has(code);
}
async function withDatabaseRetry(operation, label) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === 2) throw error;
      const delayMs = 250 * (attempt + 1);
      console.warn(`[Database] Transient ${label} failure; retrying in ${delayMs}ms`, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      const tlsEnabled = ENV.isProduction || process.env.DATABASE_SSL === "true";
      const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
      _db = drizzle({
        connection: {
          uri: ENV.databaseUrl,
          connectTimeout: 3e4,
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
          waitForConnections: true,
          connectionLimit: 2,
          maxIdle: 2,
          ...tlsEnabled ? { ssl: { rejectUnauthorized } } : {}
        }
      });
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function getDatabaseHealth() {
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
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId };
  const updateSet = {};
  const textFields = ["name", "email", "loginMethod"];
  for (const field of textFields) {
    if (user[field] !== void 0) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= /* @__PURE__ */ new Date();
  updateSet.lastSignedIn ??= /* @__PURE__ */ new Date();
  await withDatabaseRetry(
    () => db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet }),
    "user upsert"
  );
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await withDatabaseRetry(
    () => db.select().from(users).where(eq(users.openId, openId)).limit(1),
    "user lookup"
  );
  return result[0];
}
async function getUserByEmail(email) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1))[0];
}
async function getUserBySessionToken(token) {
  const db = await getDb();
  if (!db || !token) return void 0;
  const rows = await db.select({ user: users }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, /* @__PURE__ */ new Date()))).limit(1);
  return rows[0]?.user;
}
async function createSession(userId, tokenHash, expiresAt) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured.");
  await withDatabaseRetry(
    () => db.insert(sessions).values({ userId, tokenHash, expiresAt }).onDuplicateKeyUpdate({ set: { tokenHash } }),
    "session insert"
  );
}
async function revokeSession(token) {
  const db = await getDb();
  if (db && token) await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}
async function getDashboardData(userId) {
  const db = await getDb();
  if (!db) return { goals: [], tasks: [], memories: [], activity: [] };
  const [userGoals, userTasks, userMemories, userActivity] = await Promise.all([
    db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.updatedAt)),
    db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(desc(tasks.updatedAt)),
    db.select().from(memories).where(eq(memories.userId, userId)).orderBy(desc(memories.updatedAt)),
    db.select().from(activityEvents).where(eq(activityEvents.userId, userId)).orderBy(desc(activityEvents.createdAt)).limit(20)
  ]);
  return { goals: userGoals, tasks: userTasks, memories: userMemories, activity: userActivity };
}
async function recordActivity(input) {
  const db = await getDb();
  if (!db) return;
  await db.insert(activityEvents).values(input);
}
async function updateGoalProgress(userId, goalId) {
  const db = await getDb();
  if (!db) return;
  const related = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.goalId, goalId)));
  const completed = related.filter((task) => task.status === "completed").length;
  const progress = related.length ? Math.round(completed / related.length * 100) : 0;
  await db.update(goals).set({ progress, status: progress === 100 ? "completed" : "active" }).where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
}

// routers.ts
import { parse } from "cookie";

// _core/cookies.ts
import { serialize } from "cookie";
function getSessionCookieOptions(_req) {
  return { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" };
}
function setSessionCookie(res, req, name, value, maxAgeMs) {
  res.append("Set-Cookie", serialize(name, value, { ...getSessionCookieOptions(req), maxAge: Math.floor(maxAgeMs / 1e3) }));
}
function clearSessionCookie(res, req, name) {
  res.append("Set-Cookie", serialize(name, "", { ...getSessionCookieOptions(req), maxAge: 0 }));
}

// routers.ts
var prioritySchema = z.enum(["low", "medium", "high"]);
var planSchema = {
  name: "personal_ai_os_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      goalTitle: { type: "string" },
      goalDescription: { type: "string" },
      summary: { type: "string" },
      recommendation: { type: "string" },
      tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            agent: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high"] }
          },
          required: ["title", "description", "agent", "priority"]
        }
      }
    },
    required: ["goalTitle", "goalDescription", "summary", "recommendation", "tasks"]
  }
};
function readLLMText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part.text ?? "").join("\n");
  return "";
}
function requireInsertedId(rows, entity) {
  const id = rows?.[0]?.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new TRPCError2({ code: "INTERNAL_SERVER_ERROR", message: `${entity} insert did not return a valid database ID.` });
  }
  return id;
}
function requirePositiveInteger(value, entity) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TRPCError2({ code: "INTERNAL_SERVER_ERROR", message: `${entity} ID is invalid.` });
  }
  return value;
}
function isDatabaseError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("drizzlequeryerror") || message.includes("table '") || message.includes("mysql") || message.includes("database");
}
async function establishPasswordSession(ctx, userId) {
  const token = newSessionToken();
  await createSession(userId, hashSessionToken(token), new Date(Date.now() + 1e3 * 60 * 60 * 24 * 30));
  setSessionCookie(ctx.res, ctx.req, COOKIE_NAME, token, 1e3 * 60 * 60 * 24 * 30);
}
function safeAuthError(error, message) {
  if (error instanceof TRPCError2) throw error;
  console.error("[auth] password session failed", error);
  throw new TRPCError2({
    code: isDatabaseError(error) ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR",
    message: isDatabaseError(error) ? "Account services are temporarily unavailable." : message
  });
}
async function generatePlan(prompt) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You are the Planner and Critic layer of an AGI-inspired Personal AI OS. Convert a user goal into a concise execution plan. Do not reveal chain-of-thought. Return only the requested structured data. Choose practical tasks and assign one of Planner Agent, Research Agent, File Agent, Memory Agent, Task Agent, Critic Agent, or Communication Agent."
      },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_schema", json_schema: planSchema }
  });
  const raw = readLLMText(response.choices[0]?.message?.content);
  if (!raw) throw new Error("The AI returned an empty plan.");
  return JSON.parse(raw);
}
var appRouter = router({
  system: router({
    health: publicProcedure.query(() => ({ status: "ok", product: "Personal AI OS" }))
  }),
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    signup: publicProcedure.input(z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(320), password: z.string().min(10).max(200) })).mutation(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        const email = input.email.toLowerCase();
        if (await getUserByEmail(email)) throw new TRPCError2({ code: "CONFLICT", message: "An account with that email already exists." });
        const result = await db.insert(users).values({ openId: `local:${email}`, name: input.name, email, passwordHash: await hashPassword(input.password), loginMethod: "password" }).$returningId();
        const userId = requireInsertedId(result, "User");
        await establishPasswordSession(ctx, userId);
        return { success: true };
      } catch (error) {
        return safeAuthError(error, "We couldn't create your account right now. Please try again shortly.");
      }
    }),
    login: publicProcedure.input(z.object({ email: z.string().email().max(320), password: z.string().min(1).max(200) })).mutation(async ({ ctx, input }) => {
      try {
        const user = await getUserByEmail(input.email.toLowerCase());
        if (!user?.passwordHash || !await verifyPassword(input.password, user.passwordHash)) throw new TRPCError2({ code: "UNAUTHORIZED", message: "Invalid email or password." });
        const db = await getDb();
        if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        await db.update(users).set({ lastSignedIn: /* @__PURE__ */ new Date() }).where(eq2(users.id, user.id));
        await establishPasswordSession(ctx, user.id);
        return { success: true };
      } catch (error) {
        return safeAuthError(error, "We couldn't sign you in right now. Please try again shortly.");
      }
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const token = parse(ctx.req.headers?.cookie ?? "")[COOKIE_NAME];
      await revokeSession(token ?? "");
      clearSessionCookie(ctx.res, ctx.req, COOKIE_NAME);
      return { success: true };
    })
  }),
  dashboard: router({
    get: protectedProcedure.query(({ ctx }) => getDashboardData(ctx.user.id)),
    runWorkflow: protectedProcedure.input(z.object({ prompt: z.string().min(8).max(1200) })).mutation(async ({ ctx, input }) => {
      const userId = requirePositiveInteger(ctx.user.id, "User");
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured for this environment." });
      await recordActivity({ userId, eventType: "workflow_started", title: "Understanding request", description: input.prompt, agent: "Planner Agent" });
      let plan;
      try {
        plan = await generatePlan(input.prompt);
      } catch (error) {
        console.error("[AI workflow] planner failed", error);
        throw new TRPCError2({ code: "INTERNAL_SERVER_ERROR", message: "The Planner Agent could not run. Check the server AI configuration and try again." });
      }
      const createdGoal = await db.insert(goals).values({
        userId,
        title: plan.goalTitle,
        description: plan.goalDescription,
        priority: "high",
        status: "active",
        progress: 0
      }).$returningId();
      const goalId = requireInsertedId(createdGoal, "Goal");
      const safeTasks = plan.tasks.slice(0, 8);
      if (safeTasks.length) {
        await db.insert(tasks).values(safeTasks.map((task) => ({
          userId,
          goalId,
          title: task.title,
          description: task.description,
          agent: task.agent.slice(0, 80),
          priority: task.priority,
          status: "todo"
        })));
      }
      await recordActivity({ userId, eventType: "plan_created", title: `Planner generated ${safeTasks.length} tasks`, description: plan.summary, agent: "Planner Agent" });
      await recordActivity({ userId, eventType: "critic_approved", title: "Critic approved execution plan", description: plan.recommendation, agent: "Critic Agent" });
      await recordActivity({ userId, eventType: "workflow_completed", title: "Workflow ready for execution", description: "Goal and dependent tasks are now in your workspace.", agent: "Task Agent" });
      return { goalId, plan, taskCount: safeTasks.length };
    }),
    createGoal: protectedProcedure.input(z.object({ title: z.string().min(3).max(160), description: z.string().max(1e3).optional(), priority: prioritySchema })).mutation(async ({ ctx, input }) => {
      const userId = requirePositiveInteger(ctx.user.id, "User");
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const result = await db.insert(goals).values({ userId, ...input }).$returningId();
      const goalId = requireInsertedId(result, "Goal");
      await recordActivity({ userId, eventType: "goal_created", title: "Goal created", description: input.title, agent: "Task Agent" });
      return { id: goalId };
    }),
    updateGoal: protectedProcedure.input(z.object({ id: z.number().int().positive(), title: z.string().min(3).max(160).optional(), description: z.string().max(1e3).nullable().optional(), priority: prioritySchema.optional(), status: z.enum(["active", "completed", "paused"]).optional(), deadline: z.coerce.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const { id, ...changes } = input;
      const owned = await db.select({ id: goals.id }).from(goals).where(and2(eq2(goals.id, id), eq2(goals.userId, ctx.user.id))).limit(1);
      if (!owned[0]) throw new TRPCError2({ code: "NOT_FOUND", message: "Goal not found." });
      await db.update(goals).set(changes).where(and2(eq2(goals.id, id), eq2(goals.userId, ctx.user.id)));
      return { success: true };
    }),
    listGoals: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db ? db.select().from(goals).where(eq2(goals.userId, ctx.user.id)).orderBy(desc2(goals.updatedAt)) : [];
    }),
    createTask: protectedProcedure.input(z.object({ goalId: z.number().int().positive().nullable().optional(), title: z.string().min(3).max(200), description: z.string().max(1200).nullable().optional(), priority: prioritySchema, agent: z.string().max(80).optional(), dueDate: z.coerce.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      if (input.goalId) {
        const owned = await db.select({ id: goals.id }).from(goals).where(and2(eq2(goals.id, input.goalId), eq2(goals.userId, ctx.user.id))).limit(1);
        if (!owned[0]) throw new TRPCError2({ code: "NOT_FOUND", message: "Goal not found." });
      }
      const result = await db.insert(tasks).values({ userId: ctx.user.id, ...input, agent: input.agent ?? "Task Agent" }).$returningId();
      return { id: requireInsertedId(result, "Task") };
    }),
    updateTask: protectedProcedure.input(z.object({ id: z.number().int().positive(), goalId: z.number().int().positive().nullable().optional(), title: z.string().min(3).max(200).optional(), description: z.string().max(1200).nullable().optional(), priority: prioritySchema.optional(), agent: z.string().max(80).optional(), status: z.enum(["todo", "in_progress", "completed", "failed"]).optional(), dueDate: z.coerce.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const { id, ...changes } = input;
      const found = await db.select().from(tasks).where(and2(eq2(tasks.id, id), eq2(tasks.userId, ctx.user.id))).limit(1);
      if (!found[0]) throw new TRPCError2({ code: "NOT_FOUND", message: "Task not found." });
      if (changes.goalId) {
        const owned = await db.select({ id: goals.id }).from(goals).where(and2(eq2(goals.id, changes.goalId), eq2(goals.userId, ctx.user.id))).limit(1);
        if (!owned[0]) throw new TRPCError2({ code: "NOT_FOUND", message: "Goal not found." });
      }
      await db.update(tasks).set(changes).where(and2(eq2(tasks.id, id), eq2(tasks.userId, ctx.user.id)));
      if (found[0].goalId) await updateGoalProgress(ctx.user.id, found[0].goalId);
      if (changes.goalId && changes.goalId !== found[0].goalId) await updateGoalProgress(ctx.user.id, changes.goalId);
      return { success: true };
    }),
    deleteTask: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const found = await db.select().from(tasks).where(and2(eq2(tasks.id, input.id), eq2(tasks.userId, ctx.user.id))).limit(1);
      if (!found[0]) throw new TRPCError2({ code: "NOT_FOUND", message: "Task not found." });
      await db.delete(tasks).where(and2(eq2(tasks.id, input.id), eq2(tasks.userId, ctx.user.id)));
      if (found[0].goalId) await updateGoalProgress(ctx.user.id, found[0].goalId);
      return { success: true };
    }),
    toggleTask: protectedProcedure.input(z.object({ id: z.number(), completed: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const found = await db.select().from(tasks).where(and2(eq2(tasks.id, input.id), eq2(tasks.userId, ctx.user.id))).limit(1);
      const task = found[0];
      if (!task) throw new TRPCError2({ code: "NOT_FOUND", message: "Task not found." });
      await db.update(tasks).set({ status: input.completed ? "completed" : "todo" }).where(and2(eq2(tasks.id, input.id), eq2(tasks.userId, ctx.user.id)));
      if (task.goalId) await updateGoalProgress(ctx.user.id, task.goalId);
      await recordActivity({ userId: ctx.user.id, eventType: input.completed ? "task_completed" : "task_reopened", title: input.completed ? "Task completed" : "Task reopened", description: task.title, agent: task.agent });
      return { success: true };
    }),
    deleteGoal: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      await db.delete(tasks).where(and2(eq2(tasks.goalId, input.id), eq2(tasks.userId, ctx.user.id)));
      await db.delete(goals).where(and2(eq2(goals.id, input.id), eq2(goals.userId, ctx.user.id)));
      return { success: true };
    })
  }),
  memory: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(memories).where(eq2(memories.userId, ctx.user.id)).orderBy(desc2(memories.updatedAt));
    }),
    create: protectedProcedure.input(z.object({ category: z.string().min(2).max(48), content: z.string().min(3).max(600), importance: z.number().min(0).max(100) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const result = await db.insert(memories).values({ userId: ctx.user.id, ...input }).$returningId();
      await recordActivity({ userId: ctx.user.id, eventType: "memory_saved", title: "Memory saved", description: input.content, agent: "Memory Agent" });
      return { id: requireInsertedId(result, "Memory") };
    })
  }),
  chat: router({
    history: protectedProcedure.input(z.object({ conversationId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { conversation: null, messages: [] };
      const conversation = input?.conversationId ? (await db.select().from(conversations).where(and2(eq2(conversations.id, input.conversationId), eq2(conversations.userId, ctx.user.id))).limit(1))[0] : (await db.select().from(conversations).where(eq2(conversations.userId, ctx.user.id)).orderBy(desc2(conversations.updatedAt)).limit(1))[0];
      if (!conversation) return { conversation: null, messages: [] };
      return { conversation, messages: await db.select().from(messages).where(and2(eq2(messages.conversationId, conversation.id), eq2(messages.userId, ctx.user.id))).orderBy(messages.createdAt) };
    }),
    send: protectedProcedure.input(z.object({ conversationId: z.number().int().positive().optional(), content: z.string().trim().min(1).max(4e3) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError2({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      let conversationId = input.conversationId;
      if (conversationId) {
        const owned = await db.select({ id: conversations.id }).from(conversations).where(and2(eq2(conversations.id, conversationId), eq2(conversations.userId, ctx.user.id))).limit(1);
        if (!owned[0]) throw new TRPCError2({ code: "NOT_FOUND", message: "Conversation not found." });
      } else {
        conversationId = requireInsertedId(await db.insert(conversations).values({ userId: ctx.user.id, title: input.content.slice(0, 80) }).$returningId(), "Conversation");
      }
      await db.insert(messages).values({ conversationId, userId: ctx.user.id, role: "user", content: input.content });
      let answer = "I saved that in your private workspace. Configure the server AI gateway to enable a generated response.";
      try {
        const response = await invokeLLM({ messages: [{ role: "system", content: "You are the Personal AI OS assistant. Give concise, actionable answers. Never claim to have taken sensitive external actions without approval." }, { role: "user", content: input.content }], maxTokens: 700 });
        answer = readLLMText(response.choices[0]?.message?.content) || answer;
      } catch (error) {
        console.warn("[chat] AI response unavailable", error);
      }
      await db.insert(messages).values({ conversationId, userId: ctx.user.id, role: "assistant", content: answer });
      await recordActivity({ userId: ctx.user.id, eventType: "chat_completed", title: "Assistant replied", description: input.content.slice(0, 180), agent: "Communication Agent" });
      return { conversationId, answer };
    })
  }),
  activity: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(activityEvents).where(eq2(activityEvents.userId, ctx.user.id)).orderBy(desc2(activityEvents.createdAt)).limit(40);
    })
  })
});

// _core/context.ts
import { parse as parse2 } from "cookie";
async function createContext(opts) {
  const cookies = parse2(opts.req.headers?.cookie ?? "");
  const user = cookies[COOKIE_NAME] ? await getUserBySessionToken(cookies[COOKIE_NAME]) ?? null : null;
  return { ...opts, user };
}

// server/oauth.ts
import { randomBytes as randomBytes2, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { parse as parse3, serialize as serialize2 } from "cookie";
var STATE_COOKIE = "__Host-google-oauth-state";
var STATE_TTL_SECONDS = 600;
var SESSION_TTL_MS = 1e3 * 60 * 60 * 24 * 30;
function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}
function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS
  };
}
function clearStateCookie(res) {
  res.append("Set-Cookie", serialize2(STATE_COOKIE, "", { ...stateCookieOptions(), maxAge: 0 }));
}
function sameSecret(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual2(a, b);
}
function registerGoogleOAuthRoutes(app2) {
  app2.get("/api/oauth/login", (_req, res) => {
    const config = googleConfig();
    if (!config) {
      res.status(503).json({
        error: "Google OAuth is not configured.",
        required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"]
      });
      return;
    }
    const state = randomBytes2(32).toString("base64url");
    res.append("Set-Cookie", serialize2(STATE_COOKIE, state, stateCookieOptions()));
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account"
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });
  app2.get("/api/oauth/callback", async (req, res) => {
    const config = googleConfig();
    const suppliedState = typeof req.query.state === "string" ? req.query.state : void 0;
    const expectedState = parse3(req.headers.cookie ?? "")[STATE_COOKIE];
    clearStateCookie(res);
    if (!config) {
      res.status(503).json({ error: "Google OAuth is not configured." });
      return;
    }
    if (!sameSecret(suppliedState, expectedState)) {
      res.status(403).json({ error: "Invalid OAuth state." });
      return;
    }
    if (typeof req.query.error === "string") {
      res.status(400).json({ error: "Google OAuth was cancelled or denied." });
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : void 0;
    if (!code) {
      res.status(400).json({ error: "Google OAuth did not return an authorization code." });
      return;
    }
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code"
        })
      });
      if (!tokenResponse.ok) throw new Error("Google token exchange failed.");
      const token = await tokenResponse.json();
      if (!token.access_token) throw new Error("Google did not return an access token.");
      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${token.access_token}` }
      });
      if (!profileResponse.ok) throw new Error("Google identity verification failed.");
      const profile = await profileResponse.json();
      if (!profile.sub || !profile.email || profile.email_verified !== true) throw new Error("Google account email is not verified.");
      const openId = `google:${profile.sub}`;
      await upsertUser({ openId, email: profile.email.toLowerCase(), name: profile.name ?? profile.email, loginMethod: "google", lastSignedIn: /* @__PURE__ */ new Date() });
      const user = await getUserByOpenId(openId);
      if (!user) throw new Error("Google account could not be persisted.");
      const sessionToken = newSessionToken();
      await createSession(user.id, hashSessionToken(sessionToken), new Date(Date.now() + SESSION_TTL_MS));
      setSessionCookie(res, req, COOKIE_NAME, sessionToken, SESSION_TTL_MS);
      res.redirect("/app");
    } catch (error) {
      console.error("[auth] Google OAuth failed", error);
      res.status(502).json({ error: "Google sign-in could not be completed." });
    }
  });
}

// server/app.ts
var app = express();
app.use(express.json({ limit: "10mb" }));
app.get("/api/health", async (_req, res) => {
  const database = await getDatabaseHealth();
  res.status(database === "connected" ? 200 : 503).json({
    status: database === "connected" ? "ok" : "degraded",
    product: "Personal AI OS",
    database
  });
});
registerGoogleOAuthRoutes(app);
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
var app_default = app;
export {
  app,
  app_default as default
};
