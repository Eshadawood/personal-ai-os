import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { getDb } from "../server/db";
import { eq, and, desc } from "drizzle-orm";
import { goals, tasks } from "../drizzle/schema";

const user = {
  id: 1,
  openId: "integration-test-user",
  email: "integration@example.com",
  name: "Integration Test User",
  loginMethod: "integration",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const ctx: TrpcContext = {
  user,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => undefined } as TrpcContext["res"],
};

const result = await appRouter.createCaller(ctx).dashboard.runWorkflow({ prompt: "Plan my week" });
if (!Number.isInteger(result.goalId) || result.goalId <= 0) throw new Error(`Invalid returned goal ID: ${result.goalId}`);
if (!Number.isInteger(result.taskCount) || result.taskCount <= 0) throw new Error(`Invalid returned task count: ${result.taskCount}`);

const db = await getDb();
if (!db) throw new Error("Database unavailable during integration test");
const persistedGoal = (await db.select().from(goals).where(and(eq(goals.id, result.goalId), eq(goals.userId, user.id))).limit(1))[0];
const persistedTasks = await db.select().from(tasks).where(and(eq(tasks.goalId, result.goalId), eq(tasks.userId, user.id))).orderBy(desc(tasks.id));
if (!persistedGoal) throw new Error("Workflow did not persist its goal");
if (persistedTasks.length !== result.taskCount) throw new Error(`Expected ${result.taskCount} tasks, found ${persistedTasks.length}`);
for (const task of persistedTasks) {
  for (const [name, value] of Object.entries({ userId: task.userId, goalId: task.goalId, id: task.id })) {
    if (value !== null && (!Number.isInteger(value) || value <= 0)) throw new Error(`Invalid ${name} in persisted task: ${value}`);
  }
  for (const [name, value] of Object.entries({ createdAt: task.createdAt, updatedAt: task.updatedAt })) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`Invalid ${name} in persisted task`);
  }
}
console.log(JSON.stringify({ goalId: result.goalId, taskCount: persistedTasks.length, goalTitle: persistedGoal.title, taskTitles: persistedTasks.map(task => task.title) }, null, 2));
await db.delete(tasks).where(and(eq(tasks.goalId, result.goalId), eq(tasks.userId, user.id)));
await db.delete(goals).where(and(eq(goals.id, result.goalId), eq(goals.userId, user.id)));
process.exit(0);
