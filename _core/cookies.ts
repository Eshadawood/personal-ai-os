import { serialize } from "cookie";

export function getSessionCookieOptions(_req: { protocol?: string }) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
}

export function setSessionCookie(
  res: { append: (field: string, value: string) => void },
  req: { protocol?: string },
  name: string,
  value: string,
  maxAgeMs: number,
) {
  res.append("Set-Cookie", serialize(name, value, { ...getSessionCookieOptions(req), maxAge: Math.floor(maxAgeMs / 1000) }));
}

export function clearSessionCookie(
  res: { append: (field: string, value: string) => void },
  req: { protocol?: string },
  name: string,
) {
  res.append("Set-Cookie", serialize(name, "", { ...getSessionCookieOptions(req), maxAge: 0 }));
}
