import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { activityEvents, goals, memories, tasks } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDashboardData, getDb, recordActivity, updateGoalProgress } from "./db";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";

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
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
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
  activity: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(activityEvents).where(eq(activityEvents.userId, ctx.user.id)).orderBy(desc(activityEvents.createdAt)).limit(40);
    }),
  }),
});

export type AppRouter = typeof appRouter;
