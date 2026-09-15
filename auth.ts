import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [, salt, digest] = encoded.split("$");
  if (!salt || !digest) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function newSessionToken() { return randomBytes(32).toString("base64url"); }
export function hashSessionToken(token: string) {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update(token).digest("hex");
}
