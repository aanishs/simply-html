// Signed session cookie. HMAC-SHA256 over a base64url JSON payload; constant-time verify.
// Rotating the signing secret (env) invalidates every issued cookie (the revocation path).
import { createHmac, timingSafeEqual } from "node:crypto";

export interface Session {
  pageId: string;
  iat: number;
  exp: number;
}

export const COOKIE_NAME = "sh_session";
export const MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

export function signSession(s: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(value: string, secret: string, now: number): Session | null {
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const want = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (typeof s.exp !== "number" || now > s.exp) return null;
    return s;
  } catch {
    return null;
  }
}

export function buildSetCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SEC}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
