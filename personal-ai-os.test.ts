import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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
});
