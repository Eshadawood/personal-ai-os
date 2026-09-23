import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { activityEvents, conversations, goals, memories, messages, tasks } from "./drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDashboardData, getDb, recordActivity, updateGoalProgress } from "./db";
import { createSession, getUserByEmail, revokeSession } from "./db";
import { hashPassword, hashSessionToken, newSessionToken, verifyPassword } from "./auth";
import { parse } from "cookie";
import { users } from "./drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { clearSessionCookie, setSessionCookie } from "./_core/cookies";

const prioritySchema = z.enum(["low", "medium", "high"]);

const planSchema = {
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
            priority: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["title", "description", "agent", "priority"],
        },
      },
    },
    required: ["goalTitle", "goalDescription", "summary", "recommendation", "tasks"],
  },
};

type Plan = {
  goalTitle: string;
  goalDescription: string;
  summary: string;
  recommendation: string;
  tasks: Array<{ title: string; description: string; agent: string; priority: "low" | "medium" | "high" }>;
};

function readLLMText(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => (typeof part === "string" ? part : (part as { text?: string }).text ?? "")).join("\n");
  return "";
}

function extractExplicitMemory(content: string) {
  const match = content.match(/\bremember(?: that)?\s+(.+?)(?:[.!?]|$)/i);
  return match?.[1]?.trim() || null;
}

function selectRelevantMemories(memories: Array<{ content: string; category: string; importance: number }>, query: string) {
  const terms = query.toLowerCase().split(/\W+/).filter(term => term.length > 2);
  return memories
    .map(memory => ({ memory, score: terms.reduce((score, term) => score + (memory.content.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance)
    .slice(0, 8)
    .map(item => item.memory);
}

function requireInsertedId(rows: Array<{ id: number }> | undefined, entity: string) {
  const id = rows?.[0]?.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${entity} insert did not return a valid database ID.` });
  }
  return id;
}

function requirePositiveInteger(value: number, entity: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${entity} ID is invalid.` });
  }
  return value;
}

function isDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("drizzlequeryerror") || message.includes("table '") || message.includes("mysql") || message.includes("database");
}

async function establishPasswordSession(ctx: { req: any; res: any }, userId: number) {
  const token = newSessionToken();
  await createSession(userId, hashSessionToken(token), new Date(Date.now() + 1000 * 60 * 60 * 24 * 30));
  setSessionCookie(ctx.res, ctx.req, COOKIE_NAME, token, 1000 * 60 * 60 * 24 * 30);
}

function safeAuthError(error: unknown, message: string): never {
  if (error instanceof TRPCError) throw error;
  console.error("[auth] password session failed", error);
  throw new TRPCError({
    code: isDatabaseError(error) ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR",
    message: isDatabaseError(error) ? "Account services are temporarily unavailable." : message,
  });
}

async function generatePlan(prompt: string): Promise<Plan> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You are the Planner and Critic layer of an AGI-inspired Personal AI OS. Convert a user goal into a concise execution plan. Do not reveal chain-of-thought. Return only the requested structured data. Choose practical tasks and assign one of Planner Agent, Research Agent, File Agent, Memory Agent, Task Agent, Critic Agent, or Communication Agent.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_schema", json_schema: planSchema },
  });
  const raw = readLLMText(response.choices[0]?.message?.content);
  if (!raw) throw new Error("The AI returned an empty plan.");
  return JSON.parse(raw) as Plan;
}

export const appRouter = router({
  system: router({
    health: publicProcedure.query(() => ({ status: "ok", product: "Personal AI OS" })),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    signup: publicProcedure.input(z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(320), password: z.string().min(10).max(200) })).mutation(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        const email = input.email.toLowerCase();
        if (await getUserByEmail(email)) throw new TRPCError({ code: "CONFLICT", message: "An account with that email already exists." });
        const result = await db.insert(users).values({ openId: `local:${email}`, name: input.name, email, passwordHash: await hashPassword(input.password), loginMethod: "password" }).$returningId();
        const userId = requireInsertedId(result, "User");
        await establishPasswordSession(ctx, userId);
        return { success: true } as const;
      } catch (error) {
        return safeAuthError(error, "We couldn't create your account right now. Please try again shortly.");
      }
    }),
    login: publicProcedure.input(z.object({ email: z.string().email().max(320), password: z.string().min(1).max(200) })).mutation(async ({ ctx, input }) => {
      try {
        const user = await getUserByEmail(input.email.toLowerCase());
        if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
        await establishPasswordSession(ctx, user.id);
        return { success: true } as const;
      } catch (error) {
        return safeAuthError(error, "We couldn't sign you in right now. Please try again shortly.");
      }
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const token = parse(ctx.req.headers?.cookie ?? "")[COOKIE_NAME];
      await revokeSession(token ?? "");
      clearSessionCookie(ctx.res, ctx.req, COOKIE_NAME);
      return { success: true } as const;
    }),
  }),
  dashboard: router({
    get: protectedProcedure.query(({ ctx }) => getDashboardData(ctx.user.id)),
    runWorkflow: protectedProcedure
      .input(z.object({ prompt: z.string().min(8).max(1200) }))
      .mutation(async ({ ctx, input }) => {
        const userId = requirePositiveInteger(ctx.user.id, "User");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured for this environment." });

        await recordActivity({ userId, eventType: "workflow_started", title: "Understanding request", description: input.prompt, agent: "Planner Agent" });
        let plan: Plan;
        try {
          plan = await generatePlan(input.prompt);
        } catch (error) {
          console.error("[AI workflow] planner failed", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The Planner Agent could not run. Check the server AI configuration and try again." });
        }

        const createdGoal = await db.insert(goals).values({
          userId,
          title: plan.goalTitle,
          description: plan.goalDescription,
          priority: "high",
          status: "active",
          progress: 0,
        }).$returningId();
        const goalId = requireInsertedId(createdGoal, "Goal");
        const safeTasks = plan.tasks.slice(0, 8);
        if (safeTasks.length) {
          await db.insert(tasks).values(safeTasks.map(task => ({
            userId,
            goalId,
            title: task.title,
            description: task.description,
            agent: task.agent.slice(0, 80),
            priority: task.priority,
            status: "todo" as const,
          })));
        }
        await recordActivity({ userId, eventType: "plan_created", title: `Planner generated ${safeTasks.length} tasks`, description: plan.summary, agent: "Planner Agent" });
        await recordActivity({ userId, eventType: "critic_approved", title: "Critic approved execution plan", description: plan.recommendation, agent: "Critic Agent" });
        await recordActivity({ userId, eventType: "workflow_completed", title: "Workflow ready for execution", description: "Goal and dependent tasks are now in your workspace.", agent: "Task Agent" });
        return { goalId, plan, taskCount: safeTasks.length };
      }),
    createGoal: protectedProcedure
      .input(z.object({ title: z.string().min(3).max(160), description: z.string().max(1000).optional(), priority: prioritySchema }))
      .mutation(async ({ ctx, input }) => {
        const userId = requirePositiveInteger(ctx.user.id, "User");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        const result = await db.insert(goals).values({ userId, ...input }).$returningId();
        const goalId = requireInsertedId(result, "Goal");
        await recordActivity({ userId, eventType: "goal_created", title: "Goal created", description: input.title, agent: "Task Agent" });
        return { id: goalId };
      }),
    updateGoal: protectedProcedure.input(z.object({ id: z.number().int().positive(), title: z.string().min(3).max(160).optional(), description: z.string().max(1000).nullable().optional(), priority: prioritySchema.optional(), status: z.enum(["active", "completed", "paused"]).optional(), deadline: z.coerce.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const { id, ...changes } = input;
      const owned = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.id, id), eq(goals.userId, ctx.user.id))).limit(1);
      if (!owned[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Goal not found." });
      await db.update(goals).set(changes).where(and(eq(goals.id, id), eq(goals.userId, ctx.user.id)));
      return { success: true } as const;
    }),
    listGoals: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db ? db.select().from(goals).where(eq(goals.userId, ctx.user.id)).orderBy(desc(goals.updatedAt)) : [];
    }),
    createTask: protectedProcedure.input(z.object({ goalId: z.number().int().positive().nullable().optional(), title: z.string().min(3).max(200), description: z.string().max(1200).nullable().optional(), priority: prioritySchema, agent: z.string().max(80).optional(), dueDate: z.coerce.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      if (input.goalId) {
        const owned = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.id, input.goalId), eq(goals.userId, ctx.user.id))).limit(1);
        if (!owned[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Goal not found." });
      }
      const result = await db.insert(tasks).values({ userId: ctx.user.id, ...input, agent: input.agent ?? "Task Agent" }).$returningId();
      return { id: requireInsertedId(result, "Task") };
    }),
    updateTask: protectedProcedure.input(z.object({ id: z.number().int().positive(), goalId: z.number().int().positive().nullable().optional(), title: z.string().min(3).max(200).optional(), description: z.string().max(1200).nullable().optional(), priority: prioritySchema.optional(), agent: z.string().max(80).optional(), status: z.enum(["todo", "in_progress", "completed", "failed"]).optional(), dueDate: z.coerce.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const { id, ...changes } = input;
      const found = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, ctx.user.id))).limit(1);
      if (!found[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      if (changes.goalId) {
        const owned = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.id, changes.goalId), eq(goals.userId, ctx.user.id))).limit(1);
        if (!owned[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Goal not found." });
      }
      await db.update(tasks).set(changes).where(and(eq(tasks.id, id), eq(tasks.userId, ctx.user.id)));
      if (found[0].goalId) await updateGoalProgress(ctx.user.id, found[0].goalId);
      if (changes.goalId && changes.goalId !== found[0].goalId) await updateGoalProgress(ctx.user.id, changes.goalId);
      return { success: true } as const;
    }),
    deleteTask: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
      const found = await db.select().from(tasks).where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id))).limit(1);
      if (!found[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      await db.delete(tasks).where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id)));
      if (found[0].goalId) await updateGoalProgress(ctx.user.id, found[0].goalId);
      return { success: true } as const;
    }),
    toggleTask: protectedProcedure
      .input(z.object({ id: z.number(), completed: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        const found = await db.select().from(tasks).where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id))).limit(1);
        const task = found[0];
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
        await db.update(tasks).set({ status: input.completed ? "completed" : "todo" }).where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id)));
        if (task.goalId) await updateGoalProgress(ctx.user.id, task.goalId);
        await recordActivity({ userId: ctx.user.id, eventType: input.completed ? "task_completed" : "task_reopened", title: input.completed ? "Task completed" : "Task reopened", description: task.title, agent: task.agent });
        return { success: true } as const;
      }),
    deleteGoal: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        await db.delete(tasks).where(and(eq(tasks.goalId, input.id), eq(tasks.userId, ctx.user.id)));
        await db.delete(goals).where(and(eq(goals.id, input.id), eq(goals.userId, ctx.user.id)));
        return { success: true } as const;
      }),
  }),
  memory: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(memories).where(eq(memories.userId, ctx.user.id)).orderBy(desc(memories.updatedAt));
    }),
    create: protectedProcedure
      .input(z.object({ category: z.string().min(2).max(48), content: z.string().min(3).max(600), importance: z.number().min(0).max(100) }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        const result = await db.insert(memories).values({ userId: ctx.user.id, ...input }).$returningId();
        await recordActivity({ userId: ctx.user.id, eventType: "memory_saved", title: "Memory saved", description: input.content, agent: "Memory Agent" });
        return { id: requireInsertedId(result, "Memory") };
      }),
  }),
  chat: router({
    history: protectedProcedure
      .input(z.object({ conversationId: z.number().int().positive().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { conversation: null, messages: [] };
        const conversation = input?.conversationId
          ? (await db.select().from(conversations).where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, ctx.user.id))).limit(1))[0]
          : (await db.select().from(conversations).where(eq(conversations.userId, ctx.user.id)).orderBy(desc(conversations.updatedAt)).limit(1))[0];
        if (!conversation) return { conversation: null, messages: [] };
        return { conversation, messages: await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.userId, ctx.user.id))).orderBy(messages.createdAt) };
      }),
    send: protectedProcedure
      .input(z.object({ conversationId: z.number().int().positive().optional(), content: z.string().trim().min(1).max(4000) }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured." });
        let conversationId = input.conversationId;
        if (conversationId) {
          const owned = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, ctx.user.id))).limit(1);
          if (!owned[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
        } else {
          conversationId = requireInsertedId(await db.insert(conversations).values({ userId: ctx.user.id, title: input.content.slice(0, 80) }).$returningId(), "Conversation");
        }
        await db.insert(messages).values({ conversationId, userId: ctx.user.id, role: "user", content: input.content });
        const explicitMemory = extractExplicitMemory(input.content);
        if (explicitMemory) {
          await db.insert(memories).values({ userId: ctx.user.id, category: "Explicit memory", content: explicitMemory, importance: 90 });
          await recordActivity({ userId: ctx.user.id, eventType: "memory_saved", title: "Memory saved from chat", description: explicitMemory, agent: "Memory Agent" });
        }
        const storedMemories = await db.select({ content: memories.content, category: memories.category, importance: memories.importance }).from(memories).where(eq(memories.userId, ctx.user.id)).orderBy(desc(memories.updatedAt)).limit(50);
        const relevantMemories = selectRelevantMemories(storedMemories, input.content);
        const memoryContext = relevantMemories.length ? "\n\nRelevant private memories (use them when helpful, never invent beyond them):\n" + relevantMemories.map(memory => "- [" + memory.category + "] " + memory.content).join("\n") : "";
        let answer = explicitMemory ? "I’ll remember that: " + explicitMemory : "I saved that in your private workspace. Configure the server AI gateway to enable a generated response.";
        try {
          const response = await invokeLLM({ messages: [{ role: "system", content: "You are the Personal AI OS assistant. Give concise, actionable answers. Use Markdown for structure (headings, lists, tables, and code when useful). Never claim to have taken sensitive external actions without approval." + memoryContext }, { role: "user", content: input.content }], maxTokens: 700 });
          answer = readLLMText(response.choices[0]?.message?.content) || answer;
        } catch (error) {
          console.warn("[chat] AI response unavailable", error);
        }
        await db.insert(messages).values({ conversationId, userId: ctx.user.id, role: "assistant", content: answer });
        await recordActivity({ userId: ctx.user.id, eventType: "chat_completed", title: "Assistant replied", description: input.content.slice(0, 180), agent: "Communication Agent" });
        return { conversationId, answer };
      }),
  }),
  activity: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(activityEvents).where(eq(activityEvents.userId, ctx.user.id)).orderBy(desc(activityEvents.createdAt)).limit(40);
    }),
  }),
  history: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { conversations: [], messages: [], activity: [], goals: [], tasks: [], memories: [] };
      const [userConversations, userMessages, userActivity, userGoals, userTasks, userMemories] = await Promise.all([
        db.select().from(conversations).where(eq(conversations.userId, ctx.user.id)).orderBy(desc(conversations.updatedAt)),
        db.select().from(messages).where(eq(messages.userId, ctx.user.id)).orderBy(desc(messages.createdAt)).limit(100),
        db.select().from(activityEvents).where(eq(activityEvents.userId, ctx.user.id)).orderBy(desc(activityEvents.createdAt)).limit(100),
        db.select().from(goals).where(eq(goals.userId, ctx.user.id)).orderBy(desc(goals.createdAt)),
        db.select().from(tasks).where(eq(tasks.userId, ctx.user.id)).orderBy(desc(tasks.createdAt)),
        db.select().from(memories).where(eq(memories.userId, ctx.user.id)).orderBy(desc(memories.createdAt)),
      ]);
      return { conversations: userConversations, messages: userMessages, activity: userActivity, goals: userGoals, tasks: userTasks, memories: userMemories };
    }),
  }),
});

export type AppRouter = typeof appRouter;
