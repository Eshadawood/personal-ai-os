import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "../_core/context";
import { registerGoogleOAuthRoutes } from "./oauth";
import { getDatabaseHealth } from "../db";

export const app = express();

app.use(express.json({ limit: "10mb" }));
app.get("/api/health", async (_req, res) => {
  const database = await getDatabaseHealth();
  res.status(database === "connected" ? 200 : 503).json({
    status: database === "connected" ? "ok" : "degraded",
    product: "Personal AI OS",
    database,
  });
});
registerGoogleOAuthRoutes(app);
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

export default app;
