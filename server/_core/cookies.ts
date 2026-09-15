export function getSessionCookieOptions(_req: { protocol?: string }) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
}
