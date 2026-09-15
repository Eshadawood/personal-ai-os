import { parse } from "cookie";
import type { User } from "../drizzle/schema";
import { getUserBySessionToken } from "../db";
import { COOKIE_NAME } from "@shared/const";

export type TrpcContext = { req: any; res: any; user: User | null };
export async function createContext(opts: { req: any; res: any }): Promise<TrpcContext> {
  const cookies = parse(opts.req.headers?.cookie ?? "");
  const user = cookies[COOKIE_NAME] ? (await getUserBySessionToken(cookies[COOKIE_NAME])) ?? null : null;
  return { ...opts, user };
}
