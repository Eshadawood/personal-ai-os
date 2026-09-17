import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "../_core/context";

export const app = express();

app.use(express.json({ limit: "10mb" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", product: "Personal AI OS" }));
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

export default app;
