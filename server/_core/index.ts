import express from "express";
import { createServer as createViteServer } from "vite";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../../routers";
import { createContext } from "../../_core/context";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", product: "Personal AI OS" }));
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
} else {
  app.use(express.static("dist/client"));
  app.get("*", (_req, res) => res.sendFile("index.html", { root: "dist/client" }));
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => console.log(`[Personal AI OS] listening on ${port}`));
