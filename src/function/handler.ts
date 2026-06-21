// The ONE serverless function: gate, page, runtime, and (flag-gated) /data + /llm.
// Page HTML + runtime JS are injected at publish; secrets + config come from env vars.
import { readBody, type VercelRequest, type VercelResponse } from "./http.js";
import { PAGE_HTML, RUNTIME_JS } from "./inject.js";
import { verifyPin } from "./pin.js";
import { signSession, verifySession, buildSetCookie, readCookie, COOKIE_NAME, MAX_AGE_SEC } from "./cookie.js";
import { renderGate } from "./gate.js";
import { isThrottled, recordFail, recordOk } from "./throttle.js";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; " +
  "manifest-src 'none'; upgrade-insecure-requests";

function env(k: string): string {
  return process.env[k] || "";
}
function cfg() {
  return {
    pageId: env("SIMPLY_HTML_PAGE_ID") || "page",
    title: env("SIMPLY_HTML_TITLE") || "Untitled",
    digits: env("SIMPLY_HTML_PIN_DIGITS") === "6" ? 6 : 4,
    db: env("SIMPLY_HTML_DB") === "1",
    llm: env("SIMPLY_HTML_LLM") === "1",
    brandName: env("SIMPLY_HTML_BRAND_NAME"),
    accent: env("SIMPLY_HTML_ACCENT"),
    pinHash: env("SIMPLY_HTML_PIN_HASH"),
    pinSalt: env("SIMPLY_HTML_PIN_SALT"),
    secret: env("SIMPLY_HTML_SIGNING_SECRET"),
  };
}

function hasSession(req: VercelRequest, c: ReturnType<typeof cfg>, now: number): boolean {
  const raw = readCookie(req.headers.cookie, COOKIE_NAME);
  if (!raw || !c.secret) return false;
  const s = verifySession(raw, c.secret, now);
  return !!s && s.pageId === c.pageId;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const c = cfg();
  const now = Date.now();
  const path = (req.url || "/").split("?")[0]!;
  const wantsJson = (req.headers["content-type"] || "").includes("application/json")
    || (req.headers["accept"] || "").includes("application/json");

  // --- PIN submit ---
  if (path.endsWith("/pin") && req.method === "POST") {
    // Durable lockout for writable/spend-capable pages (they have a Blob store); best-effort otherwise.
    const durable = c.db || c.llm;
    if (await isThrottled(c.pageId, now, durable)) {
      res.setHeader("Retry-After", "600");
      if (wantsJson) { res.status(429).json({ ok: false, error: { code: "LOCKED" } }); return; }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.status(429).send(renderGate({ digits: c.digits, error: true, brandName: c.brandName, accent: c.accent }));
      return;
    }
    const body = await readBody(req);
    const pin = String((body as { pin?: unknown }).pin ?? "");
    const ok = !!c.pinHash && !!c.pinSalt && verifyPin(pin, c.pinSalt, c.pinHash);
    if (ok) {
      await recordOk(c.pageId, durable);
      const cookie = signSession({ pageId: c.pageId, iat: now, exp: now + MAX_AGE_SEC * 1000 }, c.secret);
      res.setHeader("Set-Cookie", buildSetCookie(cookie));
      if (wantsJson) { res.status(204).end(); return; }
      res.setHeader("Location", "/");
      res.status(303).end();
      return;
    }
    await recordFail(c.pageId, now, durable);
    if (wantsJson) { res.status(401).json({ ok: false, error: { code: "BAD_PIN" } }); return; }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.status(401).send(renderGate({ digits: c.digits, error: true, brandName: c.brandName, accent: c.accent }));
    return;
  }

  // --- runtime bundle (only meaningful once unlocked, but harmless to serve) ---
  if (path.startsWith("/__sh/runtime")) {
    res.setHeader("content-type", "text/javascript; charset=utf-8");
    res.setHeader("content-security-policy", CSP);
    res.setHeader("cache-control", "no-store");
    res.status(200).send(RUNTIME_JS);
    return;
  }

  // --- everything past here requires a session ---
  const unlocked = hasSession(req, c, now);

  if (path.endsWith("/data")) {
    if (!c.db) { res.status(404).json({ ok: false, error: { code: "DISABLED" } }); return; }
    if (!unlocked) { res.status(401).json({ ok: false, error: { code: "LOCKED" } }); return; }
    const data = await import("./data.js");
    return data.handleData(req, res, c.pageId);
  }

  if (path.endsWith("/llm") && req.method === "POST") {
    if (!c.llm) { res.status(404).json({ ok: false, error: { code: "DISABLED" } }); return; }
    if (!unlocked) { res.status(401).json({ ok: false, error: { code: "LOCKED" } }); return; }
    const llm = await import("./llm.js");
    return llm.handleLlm(req, res, c.pageId, await readBody(req));
  }

  if (path.endsWith("/hub")) {
    if (!unlocked) { res.status(401).json({ ok: false, error: { code: "LOCKED" } }); return; }
    res.status(200).json([{ pageId: c.pageId, title: c.title, url: "/" }]);
    return;
  }

  // --- the page (gate-or-page) ---
  res.setHeader("content-security-policy", CSP);
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (unlocked) {
    res.status(200).send(PAGE_HTML);
  } else {
    res.status(200).send(renderGate({ digits: c.digits, brandName: c.brandName, accent: c.accent }));
  }
}
