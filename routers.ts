import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, gte, lte } from "drizzle-orm";
import { z } from "zod";
import {
  activityEvents,
  calendarEvents,
  reminders,
  documents,
  sentEmails,
  productivitySummaries,
  conversations,
  goals,
  memories,
  messages,
  tasks,
} from "./drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  getDashboardData,
  getDb,
  recordActivity,
  updateGoalProgress,
} from "./db";
import { createSession, getUserByEmail, revokeSession } from "./db";
import {
  hashPassword,
  hashSessionToken,
  newSessionToken,
  verifyPassword,
} from "./auth";
import { parse } from "cookie";
import { users, sessions } from "./drizzle/schema";
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
    required: [
      "goalTitle",
      "goalDescription",
      "summary",
      "recommendation",
      "tasks",
    ],
  },
};

type Plan = {
  goalTitle: string;
  goalDescription: string;
  summary: string;
  recommendation: string;
  tasks: Array<{
    title: string;
    description: string;
    agent: string;
    priority: "low" | "medium" | "high";
  }>;
};

function readLLMText(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : ((part as { text?: string }).text ?? ""),
      )
      .join("\n");
  return "";
}

function extractExplicitMemory(content: string) {
  const match = content.match(/\bremember(?: that)?\s+(.+?)(?:[.!?]|$)/i);
  return match?.[1]?.trim() || null;
}

function selectRelevantMemories(
  memories: Array<{ content: string; category: string; importance: number }>,
  query: string,
) {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 2);
  return memories
    .map((memory) => ({
      memory,
      score: terms.reduce(
        (score, term) =>
          score + (memory.content.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) => b.score - a.score || b.memory.importance - a.memory.importance,
    )
    .slice(0, 8)
    .map((item) => item.memory);
}

function requireInsertedId(
  rows: Array<{ id: number }> | undefined,
  entity: string,
) {
  const id = rows?.[0]?.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${entity} insert did not return a valid database ID.`,
    });
  }
  return id;
}

function requirePositiveInteger(value: number, entity: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${entity} ID is invalid.`,
    });
  }
  return value;
}

function isDatabaseError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    message.includes("drizzlequeryerror") ||
    message.includes("table '") ||
    message.includes("mysql") ||
    message.includes("database")
  );
}

async function establishPasswordSession(
  ctx: { req: any; res: any },
  userId: number,
) {
  const token = newSessionToken();
  await createSession(
    userId,
    hashSessionToken(token),
    new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  );
  setSessionCookie(
    ctx.res,
    ctx.req,
    COOKIE_NAME,
    token,
    1000 * 60 * 60 * 24 * 30,
  );
}

function safeAuthError(error: unknown, message: string): never {
  if (error instanceof TRPCError) throw error;
  console.error("[auth] password session failed", error);
  throw new TRPCError({
    code: isDatabaseError(error)
      ? "PRECONDITION_FAILED"
      : "INTERNAL_SERVER_ERROR",
    message: isDatabaseError(error)
      ? "Account services are temporarily unavailable."
      : message,
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
    health: publicProcedure.query(() => ({
      status: "ok",
      product: "Personal AI OS",
    })),
  }),
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    signup: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(120),
          email: z.string().email().max(320),
          password: z.string().min(10).max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const db = await getDb();
          if (!db)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Database is not configured.",
            });
          const email = input.email.toLowerCase();
          if (await getUserByEmail(email))
            throw new TRPCError({
              code: "CONFLICT",
              message: "An account with that email already exists.",
            });
          const result = await db
            .insert(users)
            .values({
              openId: `local:${email}`,
              name: input.name,
              email,
              passwordHash: await hashPassword(input.password),
              loginMethod: "password",
            })
            .$returningId();
          const userId = requireInsertedId(result, "User");
          await establishPasswordSession(ctx, userId);
          return { success: true } as const;
        } catch (error) {
          return safeAuthError(
            error,
            "We couldn't create your account right now. Please try again shortly.",
          );
        }
      }),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().email().max(320),
          password: z.string().min(1).max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const user = await getUserByEmail(input.email.toLowerCase());
          if (
            !user?.passwordHash ||
            !(await verifyPassword(input.password, user.passwordHash))
          )
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Invalid email or password.",
            });
          const db = await getDb();
          if (!db)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Database is not configured.",
            });
          await db
            .update(users)
            .set({ lastSignedIn: new Date() })
            .where(eq(users.id, user.id));
          await establishPasswordSession(ctx, user.id);
          return { success: true } as const;
        } catch (error) {
          return safeAuthError(
            error,
            "We couldn't sign you in right now. Please try again shortly.",
          );
        }
      }),
    changePassword: protectedProcedure
      .input(
        z.object({
          currentPassword: z.string().max(200).optional(),
          newPassword: z.string().min(10).max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const account = (
          await db
            .select()
            .from(users)
            .where(eq(users.id, ctx.user.id))
            .limit(1)
        )[0];
        if (!account)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Account not found.",
          });
        if (
          account.passwordHash &&
          (!input.currentPassword ||
            !(await verifyPassword(
              input.currentPassword,
              account.passwordHash,
            )))
        )
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Current password is incorrect.",
          });
        await db
          .update(users)
          .set({ passwordHash: await hashPassword(input.newPassword) })
          .where(eq(users.id, ctx.user.id));
        return { success: true } as const;
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
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured for this environment.",
          });

        await recordActivity({
          userId,
          eventType: "workflow_started",
          title: "Understanding request",
          description: input.prompt,
          agent: "Planner Agent",
        });
        let plan: Plan;
        try {
          plan = await generatePlan(input.prompt);
        } catch (error) {
          console.error("[AI workflow] planner failed", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "The Planner Agent could not run. Check the server AI configuration and try again.",
          });
        }

        const createdGoal = await db
          .insert(goals)
          .values({
            userId,
            title: plan.goalTitle,
            description: plan.goalDescription,
            priority: "high",
            status: "active",
            progress: 0,
          })
          .$returningId();
        const goalId = requireInsertedId(createdGoal, "Goal");
        const safeTasks = plan.tasks.slice(0, 8);
        if (safeTasks.length) {
          await db.insert(tasks).values(
            safeTasks.map((task) => ({
              userId,
              goalId,
              title: task.title,
              description: task.description,
              agent: task.agent.slice(0, 80),
              priority: task.priority,
              status: "todo" as const,
            })),
          );
        }
        await recordActivity({
          userId,
          eventType: "plan_created",
          title: `Planner generated ${safeTasks.length} tasks`,
          description: plan.summary,
          agent: "Planner Agent",
        });
        await recordActivity({
          userId,
          eventType: "critic_approved",
          title: "Critic approved execution plan",
          description: plan.recommendation,
          agent: "Critic Agent",
        });
        await recordActivity({
          userId,
          eventType: "workflow_completed",
          title: "Workflow ready for execution",
          description: "Goal and dependent tasks are now in your workspace.",
          agent: "Task Agent",
        });
        return { goalId, plan, taskCount: safeTasks.length };
      }),
    createGoal: protectedProcedure
      .input(
        z.object({
          title: z.string().min(3).max(160),
          description: z.string().max(1000).optional(),
          priority: prioritySchema,
          deadline: z.coerce.date().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const userId = requirePositiveInteger(ctx.user.id, "User");
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const result = await db
          .insert(goals)
          .values({ userId, ...input })
          .$returningId();
        const goalId = requireInsertedId(result, "Goal");
        let suggestedTaskCount = 0;
        try {
          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content:
                  "Return JSON with 3 practical, specific first tasks for the goal. Each task has title, description, and priority (low, medium, high).",
              },
              {
                role: "user",
                content: JSON.stringify({
                  title: input.title,
                  description: input.description,
                  deadline: input.deadline,
                }),
              },
            ],
            response_format: { type: "json_object" },
            maxTokens: 450,
          });
          const plan = JSON.parse(
            readLLMText(response.choices[0]?.message?.content) || "{}",
          );
          const suggested = (Array.isArray(plan.tasks) ? plan.tasks : [])
            .slice(0, 3)
            .filter((t: any) => typeof t.title === "string")
            .map((t: any) => ({
              userId,
              goalId,
              title: String(t.title).slice(0, 200),
              description: String(t.description || "").slice(0, 1200),
              priority: ["low", "medium", "high"].includes(t.priority)
                ? t.priority
                : "medium",
              agent: "Task Agent",
              status: "todo" as const,
            }));
          if (suggested.length) {
            await db.insert(tasks).values(suggested);
            suggestedTaskCount = suggested.length;
          }
        } catch (error) {
          console.warn("[goal] automatic task suggestions unavailable", error);
        }
        await recordActivity({
          userId,
          eventType: "goal_created",
          title: "Goal created",
          description: input.title,
          agent: "Task Agent",
        });
        return { id: goalId, suggestedTaskCount };
      }),
    updateGoal: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          title: z.string().min(3).max(160).optional(),
          description: z.string().max(1000).nullable().optional(),
          priority: prioritySchema.optional(),
          status: z.enum(["active", "completed", "paused"]).optional(),
          deadline: z.coerce.date().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const { id, ...changes } = input;
        const owned = await db
          .select({ id: goals.id })
          .from(goals)
          .where(and(eq(goals.id, id), eq(goals.userId, ctx.user.id)))
          .limit(1);
        if (!owned[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goal not found.",
          });
        await db
          .update(goals)
          .set(changes)
          .where(and(eq(goals.id, id), eq(goals.userId, ctx.user.id)));
        return { success: true } as const;
      }),
    listGoals: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        ? db
            .select()
            .from(goals)
            .where(eq(goals.userId, ctx.user.id))
            .orderBy(desc(goals.updatedAt))
        : [];
    }),
    createTask: protectedProcedure
      .input(
        z.object({
          goalId: z.number().int().positive().nullable().optional(),
          title: z.string().min(3).max(200),
          description: z.string().max(1200).nullable().optional(),
          priority: prioritySchema,
          agent: z.string().max(80).optional(),
          dueDate: z.coerce.date().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        if (input.goalId) {
          const owned = await db
            .select({ id: goals.id })
            .from(goals)
            .where(
              and(eq(goals.id, input.goalId), eq(goals.userId, ctx.user.id)),
            )
            .limit(1);
          if (!owned[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Goal not found.",
            });
        }
        const result = await db
          .insert(tasks)
          .values({
            userId: ctx.user.id,
            ...input,
            agent: input.agent ?? "Task Agent",
          })
          .$returningId();
        return { id: requireInsertedId(result, "Task") };
      }),
    updateTask: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          goalId: z.number().int().positive().nullable().optional(),
          title: z.string().min(3).max(200).optional(),
          description: z.string().max(1200).nullable().optional(),
          priority: prioritySchema.optional(),
          agent: z.string().max(80).optional(),
          status: z
            .enum(["todo", "in_progress", "completed", "failed"])
            .optional(),
          dueDate: z.coerce.date().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const { id, ...changes } = input;
        const found = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, id), eq(tasks.userId, ctx.user.id)))
          .limit(1);
        if (!found[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found.",
          });
        if (changes.goalId) {
          const owned = await db
            .select({ id: goals.id })
            .from(goals)
            .where(
              and(eq(goals.id, changes.goalId), eq(goals.userId, ctx.user.id)),
            )
            .limit(1);
          if (!owned[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Goal not found.",
            });
        }
        await db
          .update(tasks)
          .set(changes)
          .where(and(eq(tasks.id, id), eq(tasks.userId, ctx.user.id)));
        if (found[0].goalId)
          await updateGoalProgress(ctx.user.id, found[0].goalId);
        if (changes.goalId && changes.goalId !== found[0].goalId)
          await updateGoalProgress(ctx.user.id, changes.goalId);
        return { success: true } as const;
      }),
    deleteTask: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const found = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id)))
          .limit(1);
        if (!found[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found.",
          });
        await db
          .delete(tasks)
          .where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id)));
        if (found[0].goalId)
          await updateGoalProgress(ctx.user.id, found[0].goalId);
        return { success: true } as const;
      }),
    toggleTask: protectedProcedure
      .input(z.object({ id: z.number(), completed: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const found = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id)))
          .limit(1);
        const task = found[0];
        if (!task)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found.",
          });
        await db
          .update(tasks)
          .set({ status: input.completed ? "completed" : "todo" })
          .where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id)));
        if (task.goalId) await updateGoalProgress(ctx.user.id, task.goalId);
        await recordActivity({
          userId: ctx.user.id,
          eventType: input.completed ? "task_completed" : "task_reopened",
          title: input.completed ? "Task completed" : "Task reopened",
          description: task.title,
          agent: task.agent,
        });
        return { success: true } as const;
      }),
    deleteGoal: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        await db
          .delete(tasks)
          .where(
            and(eq(tasks.goalId, input.id), eq(tasks.userId, ctx.user.id)),
          );
        await db
          .delete(goals)
          .where(and(eq(goals.id, input.id), eq(goals.userId, ctx.user.id)));
        return { success: true } as const;
      }),
  }),
  memory: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(memories)
        .where(eq(memories.userId, ctx.user.id))
        .orderBy(desc(memories.updatedAt));
    }),
    create: protectedProcedure
      .input(
        z.object({
          category: z.string().min(2).max(48),
          content: z.string().min(3).max(600),
          importance: z.number().min(0).max(100),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const result = await db
          .insert(memories)
          .values({ userId: ctx.user.id, ...input })
          .$returningId();
        await recordActivity({
          userId: ctx.user.id,
          eventType: "memory_saved",
          title: "Memory saved",
          description: input.content,
          agent: "Memory Agent",
        });
        return { id: requireInsertedId(result, "Memory") };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          category: z.string().min(2).max(48).optional(),
          content: z.string().min(3).max(600).optional(),
          importance: z.number().int().min(0).max(100).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const { id, ...changes } = input;
        await db
          .update(memories)
          .set(changes)
          .where(and(eq(memories.id, id), eq(memories.userId, ctx.user.id)));
        return { success: true } as const;
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        await db
          .delete(memories)
          .where(
            and(eq(memories.id, input.id), eq(memories.userId, ctx.user.id)),
          );
        return { success: true } as const;
      }),
  }),
  chat: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        ? db
            .select()
            .from(conversations)
            .where(eq(conversations.userId, ctx.user.id))
            .orderBy(desc(conversations.updatedAt))
        : [];
    }),
    new: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured.",
        });
      const rows = await db
        .insert(conversations)
        .values({ userId: ctx.user.id, title: "New chat" })
        .$returningId();
      return { id: requireInsertedId(rows, "Conversation") };
    }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        await db
          .delete(messages)
          .where(
            and(
              eq(messages.conversationId, input.id),
              eq(messages.userId, ctx.user.id),
            ),
          );
        await db
          .delete(conversations)
          .where(
            and(
              eq(conversations.id, input.id),
              eq(conversations.userId, ctx.user.id),
            ),
          );
        return { success: true } as const;
      }),
    history: protectedProcedure
      .input(
        z
          .object({ conversationId: z.number().int().positive().optional() })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { conversation: null, messages: [] };
        const conversation = input?.conversationId
          ? (
              await db
                .select()
                .from(conversations)
                .where(
                  and(
                    eq(conversations.id, input.conversationId),
                    eq(conversations.userId, ctx.user.id),
                  ),
                )
                .limit(1)
            )[0]
          : (
              await db
                .select()
                .from(conversations)
                .where(eq(conversations.userId, ctx.user.id))
                .orderBy(desc(conversations.updatedAt))
                .limit(1)
            )[0];
        if (!conversation) return { conversation: null, messages: [] };
        return {
          conversation,
          messages: await db
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conversation.id),
                eq(messages.userId, ctx.user.id),
              ),
            )
            .orderBy(messages.createdAt),
        };
      }),
    send: protectedProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive().optional(),
          content: z.string().trim().min(1).max(4000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        let conversationId = input.conversationId;
        if (conversationId) {
          const owned = await db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.userId, ctx.user.id),
              ),
            )
            .limit(1);
          if (!owned[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Conversation not found.",
            });
        } else {
          conversationId = requireInsertedId(
            await db
              .insert(conversations)
              .values({
                userId: ctx.user.id,
                title: input.content.slice(0, 80),
              })
              .$returningId(),
            "Conversation",
          );
        }
        await db.insert(messages).values({
          conversationId,
          userId: ctx.user.id,
          role: "user",
          content: input.content,
        });
        const explicitMemory = extractExplicitMemory(input.content);
        const command = input.content.match(
          /^\s*(?:please\s+)?(?:create|add)\s+(task|goal)\s*:?\s*(.+)$/i,
        );
        let commandReply: string | null = null;
        if (command) {
          const [, kind, title] = command;
          if (/task/i.test(kind)) {
            const taskTitle = title.trim().slice(0, 200);
            const row = await db
              .insert(tasks)
              .values({
                userId: ctx.user.id,
                title: taskTitle,
                priority: "medium",
                agent: "Task Agent",
                status: "todo",
              })
              .$returningId();
            commandReply = `Task created: **${taskTitle}** (ID ${requireInsertedId(row, "Task")}).`;
          } else {
            const goalTitle = title.trim().slice(0, 160);
            const row = await db
              .insert(goals)
              .values({
                userId: ctx.user.id,
                title: goalTitle,
                priority: "medium",
                status: "active",
                progress: 0,
              })
              .$returningId();
            commandReply = `Goal created: **${goalTitle}** (ID ${requireInsertedId(row, "Goal")}).`;
          }
        }
        if (explicitMemory) {
          await db.insert(memories).values({
            userId: ctx.user.id,
            category: "Explicit memory",
            content: explicitMemory,
            importance: 90,
          });
          await recordActivity({
            userId: ctx.user.id,
            eventType: "memory_saved",
            title: "Memory saved from chat",
            description: explicitMemory,
            agent: "Memory Agent",
          });
        }
        const storedMemories = await db
          .select({
            content: memories.content,
            category: memories.category,
            importance: memories.importance,
          })
          .from(memories)
          .where(eq(memories.userId, ctx.user.id))
          .orderBy(desc(memories.updatedAt))
          .limit(50);
        const relevantMemories = selectRelevantMemories(
          storedMemories,
          input.content,
        );
        const memoriesForPrompt = relevantMemories.length
          ? relevantMemories
          : storedMemories.slice(0, 8);
        const memoryContext = memoriesForPrompt.length
          ? "\n\nRelevant private memories (use these as the source of truth when the user asks about their preferences, goals, or remembered facts; never invent beyond them):\n" +
            memoriesForPrompt
              .map((memory) => "- [" + memory.category + "] " + memory.content)
              .join("\n")
          : "";
        const isMemoryRecall =
          !explicitMemory &&
          storedMemories.length > 0 &&
          /\b(what|which|do you remember|remember|main goal|my goal)\b/i.test(
            input.content,
          );
        let answer =
          commandReply ??
          (explicitMemory
            ? "I’ll remember that: " + explicitMemory
            : isMemoryRecall
              ? "I remember: " +
                memoriesForPrompt.map((memory) => memory.content).join("; ")
              : "I saved that in your private workspace. Configure the server AI gateway to enable a generated response.");
        if (!isMemoryRecall && !commandReply && !explicitMemory) {
          try {
            const response = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content:
                    "You are the Personal AI OS assistant. Give concise, actionable answers. Use Markdown for structure (headings, lists, tables, and code when useful). Never claim to have taken sensitive external actions without approval." +
                    memoryContext,
                },
                { role: "user", content: input.content },
              ],
              maxTokens: 700,
            });
            answer =
              readLLMText(response.choices[0]?.message?.content) || answer;
          } catch (error) {
            console.warn("[chat] AI response unavailable", error);
          }
        }
        await db.insert(messages).values({
          conversationId,
          userId: ctx.user.id,
          role: "assistant",
          content: answer,
        });
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(conversations.userId, ctx.user.id),
            ),
          );
        await recordActivity({
          userId: ctx.user.id,
          eventType: "chat_completed",
          title: "Assistant replied",
          description: input.content.slice(0, 180),
          agent: "Communication Agent",
        });
        return { conversationId, answer };
      }),
  }),
  calendar: router({
    list: protectedProcedure
      .input(
        z
          .object({
            from: z.coerce.date().optional(),
            to: z.coerce.date().optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return [];
        const filters = [eq(calendarEvents.userId, ctx.user.id)];
        if (input?.from)
          filters.push(gte(calendarEvents.startsAt, input.from) as never);
        if (input?.to)
          filters.push(lte(calendarEvents.startsAt, input.to) as never);
        return db
          .select()
          .from(calendarEvents)
          .where(and(...filters))
          .orderBy(calendarEvents.startsAt);
      }),
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().trim().min(1).max(200),
          description: z.string().max(2000).optional(),
          startsAt: z.coerce.date(),
          endsAt: z.coerce.date().nullable().optional(),
          allDay: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const r = await db
          .insert(calendarEvents)
          .values({
            userId: ctx.user.id,
            title: input.title,
            description: input.description,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            allDay: input.allDay ? 1 : 0,
          })
          .$returningId();
        return { id: requireInsertedId(r, "Calendar event") };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        await db
          .delete(calendarEvents)
          .where(
            and(
              eq(calendarEvents.id, input.id),
              eq(calendarEvents.userId, ctx.user.id),
            ),
          );
        return { success: true } as const;
      }),
  }),
  reminders: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        ? db
            .select()
            .from(reminders)
            .where(eq(reminders.userId, ctx.user.id))
            .orderBy(reminders.dueAt)
        : [];
    }),
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().trim().min(1).max(200),
          dueAt: z.coerce.date(),
          recurrence: z
            .enum(["none", "daily", "weekly", "monthly"])
            .default("none"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const r = await db
          .insert(reminders)
          .values({ userId: ctx.user.id, ...input })
          .$returningId();
        return { id: requireInsertedId(r, "Reminder") };
      }),
    complete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const item = (
          await db
            .select()
            .from(reminders)
            .where(
              and(
                eq(reminders.id, input.id),
                eq(reminders.userId, ctx.user.id),
              ),
            )
            .limit(1)
        )[0];
        if (!item)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Reminder not found.",
          });
        if (item.recurrence !== "none") {
          const next = new Date(item.dueAt);
          if (item.recurrence === "daily") next.setDate(next.getDate() + 1);
          if (item.recurrence === "weekly") next.setDate(next.getDate() + 7);
          if (item.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
          await db
            .update(reminders)
            .set({ dueAt: next })
            .where(eq(reminders.id, item.id));
        } else
          await db
            .update(reminders)
            .set({ completedAt: new Date() })
            .where(eq(reminders.id, item.id));
        return { success: true } as const;
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        await db
          .delete(reminders)
          .where(
            and(eq(reminders.id, input.id), eq(reminders.userId, ctx.user.id)),
          );
        return { success: true } as const;
      }),
  }),
  documents: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        ? db
            .select({
              id: documents.id,
              filename: documents.filename,
              mimeType: documents.mimeType,
              summary: documents.summary,
              createdAt: documents.createdAt,
            })
            .from(documents)
            .where(eq(documents.userId, ctx.user.id))
            .orderBy(desc(documents.createdAt))
        : [];
    }),
    upload: protectedProcedure
      .input(
        z.object({
          filename: z.string().min(1).max(255),
          mimeType: z.enum([
            "text/plain",
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ]),
          dataBase64: z.string().min(1).max(9_000_000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const bytes = Buffer.from(input.dataBase64, "base64");
        if (bytes.length > 6_000_000)
          throw new TRPCError({
            code: "PAYLOAD_TOO_LARGE",
            message: "Documents must be 6 MB or smaller.",
          });
        let content = "";
        try {
          if (input.mimeType === "text/plain") content = bytes.toString("utf8");
          else if (input.mimeType === "application/pdf") {
            const parsePdf = (await import("pdf-parse")).default;
            content = (await parsePdf(bytes)).text;
          } else {
            const mammoth = (await import("mammoth")).default;
            content = (await mammoth.extractRawText({ buffer: bytes })).value;
          }
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Could not extract text from this document.",
          });
        }
        content = content.replace(/\s+/g, " ").trim().slice(0, 500000);
        if (!content)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No readable text was found in the document.",
          });
        let summary: string;
        try {
          const res = await invokeLLM({
            messages: [
              {
                role: "system",
                content:
                  "Summarize the supplied document in 3-5 concise sentences. Preserve factual nuance.",
              },
              { role: "user", content: content.slice(0, 18000) },
            ],
            maxTokens: 300,
          });
          summary = readLLMText(res.choices[0]?.message?.content).trim();
          if (!summary) throw new Error("empty");
        } catch {
          summary =
            "Summary unavailable because the AI service could not summarize this file. Extract preview: " +
            content.slice(0, 450) +
            (content.length > 450 ? "…" : "");
        }
        const r = await db
          .insert(documents)
          .values({
            userId: ctx.user.id,
            filename: input.filename,
            mimeType: input.mimeType,
            content,
            summary,
          })
          .$returningId();
        return { id: requireInsertedId(r, "Document"), summary };
      }),
    search: protectedProcedure
      .input(z.object({ query: z.string().trim().min(1).max(200) }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return [];
        const q = `%${input.query}%`;
        return db
          .select({
            id: documents.id,
            filename: documents.filename,
            summary: documents.summary,
            excerpt: documents.content,
          })
          .from(documents)
          .where(
            and(
              eq(documents.userId, ctx.user.id),
              or(
                like(documents.filename, q),
                like(documents.content, q),
                like(documents.summary, q),
              ),
            ),
          )
          .limit(20)
          .then((rows) =>
            rows.map((r) => ({ ...r, excerpt: r.excerpt.slice(0, 500) })),
          );
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        await db
          .delete(documents)
          .where(
            and(eq(documents.id, input.id), eq(documents.userId, ctx.user.id)),
          );
        return { success: true } as const;
      }),
  }),
  search: router({
    global: protectedProcedure
      .input(z.object({ query: z.string().trim().min(1).max(160) }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          return {
            chats: [],
            messages: [],
            memories: [],
            goals: [],
            tasks: [],
            documents: [],
          };
        const q = `%${input.query}%`;
        const [cs, ms, gs, ts, ds] = await Promise.all([
          db
            .select({
              id: conversations.id,
              title: conversations.title,
              updatedAt: conversations.updatedAt,
            })
            .from(conversations)
            .where(
              and(
                eq(conversations.userId, ctx.user.id),
                like(conversations.title, q),
              ),
            )
            .limit(15),
          db
            .select({
              id: memories.id,
              content: memories.content,
              category: memories.category,
            })
            .from(memories)
            .where(
              and(eq(memories.userId, ctx.user.id), like(memories.content, q)),
            )
            .limit(15),
          db
            .select({
              id: goals.id,
              title: goals.title,
              description: goals.description,
            })
            .from(goals)
            .where(
              and(
                eq(goals.userId, ctx.user.id),
                or(like(goals.title, q), like(goals.description, q)),
              ),
            )
            .limit(15),
          db
            .select({
              id: tasks.id,
              title: tasks.title,
              description: tasks.description,
            })
            .from(tasks)
            .where(
              and(
                eq(tasks.userId, ctx.user.id),
                or(like(tasks.title, q), like(tasks.description, q)),
              ),
            )
            .limit(15),
          db
            .select({
              id: documents.id,
              filename: documents.filename,
              summary: documents.summary,
            })
            .from(documents)
            .where(
              and(
                eq(documents.userId, ctx.user.id),
                or(
                  like(documents.filename, q),
                  like(documents.content, q),
                  like(documents.summary, q),
                ),
              ),
            )
            .limit(15),
        ]);
        const messageMatches = await db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            content: messages.content,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(
            and(eq(messages.userId, ctx.user.id), like(messages.content, q)),
          )
          .orderBy(desc(messages.createdAt))
          .limit(15);
        return {
          chats: cs,
          messages: messageMatches,
          memories: ms,
          goals: gs,
          tasks: ts,
          documents: ds,
        };
      }),
  }),
  productivity: router({
    insights: protectedProcedure.query(async ({ ctx }) => {
      const data = await getDashboardData(ctx.user.id);
      const today = new Date();
      const overdue = data.tasks.filter(
        (t) =>
          t.status !== "completed" && t.dueDate && new Date(t.dueDate) < today,
      );
      const inactive = data.goals.filter(
        (g) =>
          g.status === "active" &&
          Date.now() - new Date(g.updatedAt).getTime() > 14 * 86400000,
      );
      return {
        overdue: overdue.map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate,
        })),
        inactive: inactive.map((g) => ({
          id: g.id,
          title: g.title,
          progress: g.progress,
        })),
        counts: {
          tasks: data.tasks.length,
          completed: data.tasks.filter((t) => t.status === "completed").length,
          activeGoals: data.goals.filter((g) => g.status === "active").length,
        },
      };
    }),
    smartSuggestions: protectedProcedure.mutation(async ({ ctx }) => {
      const data = await getDashboardData(ctx.user.id);
      const now = new Date();
      const overdue = data.tasks
        .filter(
          (t) =>
            t.status !== "completed" && t.dueDate && new Date(t.dueDate) < now,
        )
        .map((t) => ({
          type: "overdue task",
          title: t.title,
          dueDate: t.dueDate,
        }));
      const inactive = data.goals
        .filter(
          (g) =>
            g.status === "active" &&
            Date.now() - new Date(g.updatedAt).getTime() > 14 * 86400000,
        )
        .map((g) => ({
          type: "inactive goal",
          title: g.title,
          progress: g.progress,
        }));
      if (!overdue.length && !inactive.length)
        return {
          suggestions:
            "Nothing needs urgent attention right now. Keep building on your current momentum.",
        };
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "Give 2-4 brief personalized next-step suggestions for the user's overdue tasks and inactive goals. Refer only to the supplied data. Be concrete and kind; use Markdown.",
          },
          { role: "user", content: JSON.stringify({ overdue, inactive }) },
        ],
        maxTokens: 350,
      });
      return {
        suggestions: readLLMText(response.choices[0]?.message?.content),
      };
    }),
    generateGoalTasks: protectedProcedure
      .input(z.object({ goalId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const goal = (
          await db
            .select()
            .from(goals)
            .where(
              and(eq(goals.id, input.goalId), eq(goals.userId, ctx.user.id)),
            )
            .limit(1)
        )[0];
        if (!goal)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goal not found.",
          });
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content:
                "Create 3 practical, sequential next-action tasks for this goal. Return JSON with a tasks array; each item has title, description, priority (low, medium, high).",
            },
            {
              role: "user",
              content: JSON.stringify({
                title: goal.title,
                description: goal.description,
                progress: goal.progress,
              }),
            },
          ],
          response_format: { type: "json_object" },
          maxTokens: 500,
        });
        const result = JSON.parse(
          readLLMText(response.choices[0]?.message?.content) || "{}",
        );
        const safe = (Array.isArray(result.tasks) ? result.tasks : [])
          .slice(0, 5)
          .filter((t: any) => typeof t.title === "string")
          .map((t: any) => ({
            userId: ctx.user.id,
            goalId: goal.id,
            title: String(t.title).slice(0, 200),
            description: String(t.description || "").slice(0, 1200),
            priority: ["low", "medium", "high"].includes(t.priority)
              ? t.priority
              : "medium",
            agent: "Task Agent",
            status: "todo" as const,
          }));
        if (!safe.length)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The AI did not return usable tasks.",
          });
        await db.insert(tasks).values(safe);
        return {
          created: safe.length,
          tasks: safe.map((t: { title: string }) => t.title),
        };
      }),
    recentSummaries: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        ? db
            .select()
            .from(productivitySummaries)
            .where(eq(productivitySummaries.userId, ctx.user.id))
            .orderBy(desc(productivitySummaries.weekOf))
            .limit(8)
        : [];
    }),
    weeklySummary: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured.",
        });
      const since = new Date(Date.now() - 7 * 86400000);
      const [gs, ts, ev] = await Promise.all([
        db.select().from(goals).where(eq(goals.userId, ctx.user.id)),
        db.select().from(tasks).where(eq(tasks.userId, ctx.user.id)),
        db
          .select()
          .from(activityEvents)
          .where(
            and(
              eq(activityEvents.userId, ctx.user.id),
              gte(activityEvents.createdAt, since),
            ),
          )
          .orderBy(desc(activityEvents.createdAt))
          .limit(60),
      ]);
      const context = JSON.stringify({
        goals: gs.map((g) => ({
          title: g.title,
          progress: g.progress,
          status: g.status,
        })),
        tasks: ts.map((t) => ({
          title: t.title,
          status: t.status,
          priority: t.priority,
        })),
        activity: ev.map((e) => e.title),
      });
      const res = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "Write a concise personalized weekly productivity summary with wins, patterns, and 2 practical next steps. Use Markdown. Base every claim only on supplied data.",
          },
          { role: "user", content: context },
        ],
        maxTokens: 450,
      });
      const summary = readLLMText(res.choices[0]?.message?.content);
      await db
        .insert(productivitySummaries)
        .values({ userId: ctx.user.id, weekOf: since, summary });
      return { summary };
    }),
  }),
  email: router({
    draft: protectedProcedure
      .input(z.object({ prompt: z.string().min(3).max(2000) }))
      .mutation(async ({ input }) => {
        const r = await invokeLLM({
          messages: [
            {
              role: "system",
              content:
                "Draft a clear professional email. Return JSON with recipient (empty if unknown), subject, body. Do not send.",
            },
            { role: "user", content: input.prompt },
          ],
          response_format: { type: "json_object" },
          maxTokens: 500,
        });
        try {
          return JSON.parse(readLLMText(r.choices[0]?.message?.content));
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not draft email.",
          });
        }
      }),
    send: protectedProcedure
      .input(
        z.object({
          recipient: z.string().email().max(320),
          subject: z.string().min(1).max(300),
          body: z.string().min(1).max(12000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const apiKey = process.env.RESEND_API_KEY;
        const from = process.env.RESEND_FROM;
        if (!apiKey || !from)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Email is not configured. Set RESEND_API_KEY and RESEND_FROM in the deployment's secure environment, and verify the sender domain in Resend.",
          });
        let status: "sent" | "failed" = "failed",
          providerId: string | null = null,
          error: string | null = null;
        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from,
              to: [input.recipient],
              subject: input.subject,
              text: input.body,
            }),
          });
          const result = (await response.json()) as {
            id?: string;
            message?: string;
          };
          if (!response.ok)
            throw new Error(
              result.message || `Resend returned ${response.status}`,
            );
          status = "sent";
          providerId = result.id ?? null;
        } catch (e) {
          error = e instanceof Error ? e.message : "Delivery failed";
        }
        await db
          .insert(sentEmails)
          .values({ userId: ctx.user.id, ...input, status, providerId, error });
        if (status === "failed")
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: `Email delivery failed: ${error}`,
          });
        return { status, providerId };
      }),
    history: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        ? db
            .select()
            .from(sentEmails)
            .where(eq(sentEmails.userId, ctx.user.id))
            .orderBy(desc(sentEmails.createdAt))
            .limit(100)
        : [];
    }),
  }),
  privacy: router({
    export: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured.",
        });
      const [
        userGoals,
        userTasks,
        userMemories,
        userConversations,
        userMessages,
        userEvents,
        userReminders,
        userCalendar,
        userDocuments,
        userEmails,
        userSummaries,
      ] = await Promise.all([
        db.select().from(goals).where(eq(goals.userId, ctx.user.id)),
        db.select().from(tasks).where(eq(tasks.userId, ctx.user.id)),
        db.select().from(memories).where(eq(memories.userId, ctx.user.id)),
        db
          .select()
          .from(conversations)
          .where(eq(conversations.userId, ctx.user.id)),
        db.select().from(messages).where(eq(messages.userId, ctx.user.id)),
        db
          .select()
          .from(activityEvents)
          .where(eq(activityEvents.userId, ctx.user.id)),
        db.select().from(reminders).where(eq(reminders.userId, ctx.user.id)),
        db
          .select()
          .from(calendarEvents)
          .where(eq(calendarEvents.userId, ctx.user.id)),
        db
          .select({
            id: documents.id,
            filename: documents.filename,
            mimeType: documents.mimeType,
            content: documents.content,
            summary: documents.summary,
            createdAt: documents.createdAt,
          })
          .from(documents)
          .where(eq(documents.userId, ctx.user.id)),
        db.select().from(sentEmails).where(eq(sentEmails.userId, ctx.user.id)),
        db
          .select()
          .from(productivitySummaries)
          .where(eq(productivitySummaries.userId, ctx.user.id)),
      ]);
      return {
        exportedAt: new Date().toISOString(),
        goals: userGoals,
        tasks: userTasks,
        memories: userMemories,
        conversations: userConversations,
        messages: userMessages,
        activity: userEvents,
        reminders: userReminders,
        calendar: userCalendar,
        documents: userDocuments,
        sentEmails: userEmails,
        productivitySummaries: userSummaries,
      };
    }),
    clearHistory: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured.",
        });
      await db.delete(messages).where(eq(messages.userId, ctx.user.id));
      await db
        .delete(conversations)
        .where(eq(conversations.userId, ctx.user.id));
      await db
        .delete(activityEvents)
        .where(eq(activityEvents.userId, ctx.user.id));
      return { success: true } as const;
    }),
    sessions: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        ? db
            .select({
              id: sessions.id,
              createdAt: sessions.createdAt,
              expiresAt: sessions.expiresAt,
            })
            .from(sessions)
            .where(eq(sessions.userId, ctx.user.id))
            .orderBy(desc(sessions.createdAt))
        : [];
    }),
    revokeSession: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        await db
          .delete(sessions)
          .where(
            and(eq(sessions.id, input.id), eq(sessions.userId, ctx.user.id)),
          );
        return { success: true } as const;
      }),
    deleteAccount: protectedProcedure
      .input(z.object({ password: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured.",
          });
        const user = (
          await db
            .select()
            .from(users)
            .where(eq(users.id, ctx.user.id))
            .limit(1)
        )[0];
        if (
          user?.passwordHash &&
          (!input.password ||
            !(await verifyPassword(input.password, user.passwordHash)))
        )
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Password confirmation is incorrect.",
          });
        const id = ctx.user.id;
        for (const table of [
          messages,
          conversations,
          activityEvents,
          memories,
          tasks,
          goals,
          calendarEvents,
          reminders,
          documents,
          sentEmails,
          productivitySummaries,
          sessions,
        ])
          await db.delete(table).where(eq(table.userId, id));
        await db.delete(users).where(eq(users.id, id));
        clearSessionCookie(ctx.res, ctx.req, COOKIE_NAME);
        return { success: true } as const;
      }),
  }),
  activity: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.userId, ctx.user.id))
        .orderBy(desc(activityEvents.createdAt))
        .limit(40);
    }),
  }),
  history: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db)
        return {
          conversations: [],
          messages: [],
          activity: [],
          goals: [],
          tasks: [],
          memories: [],
        };
      const [
        userConversations,
        userMessages,
        userActivity,
        userGoals,
        userTasks,
        userMemories,
      ] = await Promise.all([
        db
          .select()
          .from(conversations)
          .where(eq(conversations.userId, ctx.user.id))
          .orderBy(desc(conversations.updatedAt)),
        db
          .select()
          .from(messages)
          .where(eq(messages.userId, ctx.user.id))
          .orderBy(desc(messages.createdAt))
          .limit(100),
        db
          .select()
          .from(activityEvents)
          .where(eq(activityEvents.userId, ctx.user.id))
          .orderBy(desc(activityEvents.createdAt))
          .limit(100),
        db
          .select()
          .from(goals)
          .where(eq(goals.userId, ctx.user.id))
          .orderBy(desc(goals.createdAt)),
        db
          .select()
          .from(tasks)
          .where(eq(tasks.userId, ctx.user.id))
          .orderBy(desc(tasks.createdAt)),
        db
          .select()
          .from(memories)
          .where(eq(memories.userId, ctx.user.id))
          .orderBy(desc(memories.createdAt)),
      ]);
      return {
        conversations: userConversations,
        messages: userMessages,
        activity: userActivity,
        goals: userGoals,
        tasks: userTasks,
        memories: userMemories,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
