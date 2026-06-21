// Local stand-ins for @vercel/node's request/response types (type-only — erased at build).
// Vercel's runtime augments the Node req/res with these members; we only need the surface
// to typecheck against, which lets us drop the @vercel/node devDependency entirely.
import type { IncomingMessage, ServerResponse } from "node:http";

export type VercelRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, string | string[]>;
};

export type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  send(body: string | Buffer): void;
};

/**
 * Read a request body to an object, capped (default 1 MB) so an oversized body can't pile up
 * in memory. Honors Vercel's pre-parsed `req.body`, JSON, and form-urlencoded (the PIN POST).
 * Shared by the gate/llm handler and the /data store so the size cap lives in exactly one place.
 */
export async function readBody(req: VercelRequest, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  const ct = (req.headers["content-type"] || "").toLowerCase();
  let raw = "";
  let tooBig = false;
  await new Promise<void>((resolve) => {
    req.on("data", (c) => { raw += c; if (raw.length > maxBytes) { tooBig = true; req.destroy(); } });
    req.on("end", () => resolve());
    req.on("error", () => resolve());
  });
  if (tooBig) return {};
  if (ct.includes("application/json")) {
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }
  const out: Record<string, string> = {};
  for (const pair of raw.split("&")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, " "));
  }
  return out;
}
