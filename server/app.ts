import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "../_core/context";
import { registerGoogleOAuthRoutes } from "./oauth";

export const app = express();

app.use(express.json({ limit: "10mb" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", product: "Personal AI OS" }));
registerGoogleOAuthRoutes(app);
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

export default app;
