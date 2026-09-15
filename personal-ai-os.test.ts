import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { hashPassword, verifyPassword, hashSessionToken } from "./auth";

function createContext(user: TrpcContext["user"] = null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("Personal AI OS contracts", () => {
  it("reports a healthy public system status", async () => {
    const result = await appRouter.createCaller(createContext()).system.health();
    expect(result).toEqual({ status: "ok", product: "Personal AI OS" });
  });

  it("protects autonomous workflow execution behind authentication", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.dashboard.runWorkflow({ prompt: "Plan my week around high impact work" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("hashes passwords and derives opaque session hashes", async () => {
    process.env.AUTH_SESSION_SECRET = "test-session-secret";
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPassword("wrong password", encoded)).toBe(false);
    expect(hashSessionToken("token-a")).not.toBe(hashSessionToken("token-b"));
  });

  it("protects chat history and user-owned data behind authentication", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.chat.history()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.dashboard.listGoals()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
