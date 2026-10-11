import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { hashPassword, verifyPassword, hashSessionToken } from "./auth";
import { extractPdfText } from "./server/pdf";

function createContext(user: TrpcContext["user"] = null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("Personal AI OS contracts", () => {
  it("extracts text from a standard PDF with PDF.js", async () => {
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Length 44 >>\nstream\nBT /F1 18 Tf 72 720 Td (PDF.js migration works) Tj ET\nendstream",
    ];
    let source = "%PDF-1.4\n";
    const offsets = [0];
    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(Buffer.byteLength(source));
      source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(source);
    source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index += 1) {
      source += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    await expect(extractPdfText(Buffer.from(source))).resolves.toContain(
      "PDF.js migration works",
    );
  });

  it("reports a healthy public system status", async () => {
    const result = await appRouter
      .createCaller(createContext())
      .system.health();
    expect(result).toEqual({ status: "ok", product: "Personal AI OS" });
  });

  it("protects autonomous workflow execution behind authentication", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(
      caller.dashboard.runWorkflow({
        prompt: "Plan my week around high impact work",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("hashes passwords and derives opaque session hashes", async () => {
    process.env.AUTH_SESSION_SECRET = "test-session-secret";
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(
      true,
    );
    expect(await verifyPassword("wrong password", encoded)).toBe(false);
    expect(hashSessionToken("token-a")).not.toBe(hashSessionToken("token-b"));
  });

  it("protects chat history and user-owned data behind authentication", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.chat.history()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.dashboard.listGoals()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("protects all new personal data and email procedures behind authentication", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.calendar.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.reminders.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.documents.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.search.global({ query: "private" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.productivity.insights()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.email.history()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.privacy.export()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
