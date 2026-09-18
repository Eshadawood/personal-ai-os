import type { Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { parse, serialize } from "cookie";
import { getUserByOpenId, upsertUser, createSession } from "../db";
import { hashSessionToken, newSessionToken } from "../auth";
import { COOKIE_NAME } from "../shared/const";
import { setSessionCookie } from "../_core/cookies";

const STATE_COOKIE = "__Host-google-oauth-state";
const STATE_TTL_SECONDS = 600;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  };
}

function clearStateCookie(res: Response) {
  res.append("Set-Cookie", serialize(STATE_COOKIE, "", { ...stateCookieOptions(), maxAge: 0 }));
}

function sameSecret(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerGoogleOAuthRoutes(app: { get: (path: string, handler: (req: Request, res: Response) => unknown) => void }) {
  app.get("/api/oauth/login", (_req, res) => {
    const config = googleConfig();
    if (!config) {
      res.status(503).json({
        error: "Google OAuth is not configured.",
        required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"],
      });
      return;
    }

    const state = randomBytes(32).toString("base64url");
    res.append("Set-Cookie", serialize(STATE_COOKIE, state, stateCookieOptions()));
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/oauth/callback", async (req, res) => {
    const config = googleConfig();
    const suppliedState = typeof req.query.state === "string" ? req.query.state : undefined;
    const expectedState = parse(req.headers.cookie ?? "")[STATE_COOKIE];
    clearStateCookie(res);

    if (!config) {
      res.status(503).json({ error: "Google OAuth is not configured." });
      return;
    }
    if (!sameSecret(suppliedState, expectedState)) {
      res.status(403).json({ error: "Invalid OAuth state." });
      return;
    }
    if (typeof req.query.error === "string") {
      res.status(400).json({ error: "Google OAuth was cancelled or denied." });
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    if (!code) {
      res.status(400).json({ error: "Google OAuth did not return an authorization code." });
      return;
    }

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenResponse.ok) throw new Error("Google token exchange failed.");
      const token = (await tokenResponse.json()) as { access_token?: string };
      if (!token.access_token) throw new Error("Google did not return an access token.");

      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!profileResponse.ok) throw new Error("Google identity verification failed.");
      const profile = (await profileResponse.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
      if (!profile.sub || !profile.email || profile.email_verified !== true) throw new Error("Google account email is not verified.");

      const openId = `google:${profile.sub}`;
      await upsertUser({ openId, email: profile.email.toLowerCase(), name: profile.name ?? profile.email, loginMethod: "google", lastSignedIn: new Date() });
      const user = await getUserByOpenId(openId);
      if (!user) throw new Error("Google account could not be persisted.");

      const sessionToken = newSessionToken();
      await createSession(user.id, hashSessionToken(sessionToken), new Date(Date.now() + SESSION_TTL_MS));
      setSessionCookie(res, req, COOKIE_NAME, sessionToken, SESSION_TTL_MS);
      res.redirect("/app");
    } catch (error) {
      console.error("[auth] Google OAuth failed", error);
      res.status(502).json({ error: "Google sign-in could not be completed." });
    }
  });
}
