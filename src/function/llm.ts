// Flag-gated /llm proxy (only loaded when --llm). Buffered Anthropic Messages call with
// DURABLE daily caps in Vercel Blob: a per-page counter AND a global per-key counter, both
// read-modify-write with ETag CAS so a leaked PIN can't overspend across cold starts or
// across many pages. Counters reserve a slot BEFORE the model call (fail toward not
// overspending). The cap is still soft under heavy concurrency (documented).
import type { VercelRequest, VercelResponse } from "./http.js";
import { createHash } from "node:crypto";
import { strip, streamToString, type BlobApi } from "./blob.js";

const today = (): string => new Date(Date.now()).toISOString().slice(0, 10);

/** Reserve one unit against a daily counter at `path`. Returns true if OVER the cap. */
async function reserve(blob: BlobApi, path: string, cap: number): Promise<boolean> {
  const day = today();
  const PRIVATE = { access: "private" as const };
  for (let attempt = 0; attempt < 3; attempt++) {
    let etag: string | null = null;
    let n = 0;
    try {
      etag = strip((await blob.head(path, PRIVATE)).etag);
      const g = await blob.get(path, PRIVATE);
      if (g && g.statusCode === 200 && g.stream) {
        const cur = JSON.parse(await streamToString(g.stream)) as { day?: string; n?: number };
        n = cur.day === day ? cur.n || 0 : 0;
      }
    } catch { etag = null; n = 0; }
    if (n >= cap) return true;
    try {
      await blob.put(path, JSON.stringify({ day, n: n + 1 }), {
        ...PRIVATE,
        allowOverwrite: true,
        contentType: "application/json",
        ...(etag ? { ifMatch: `"${etag}"` } : {}),
      });
      return false;
    } catch (e) {
      if ((e as Error)?.name === "BlobPreconditionFailedError") continue; // raced; retry
      return false; // storage hiccup: fail open rather than break the page (documented soft cap)
    }
  }
  return false;
}

export async function handleLlm(
  req: VercelRequest,
  res: VercelResponse,
  pageId: string,
  body: Record<string, unknown>,
): Promise<void> {
  // Two providers, in priority order:
  //   1. BYO Anthropic key (SIMPLY_HTML_MODEL_KEY)        -> native Anthropic API
  //   2. Vercel AI Gateway via auto-injected OIDC token -> no key, billed to the Vercel acct
  const byoKey = process.env.SIMPLY_HTML_MODEL_KEY || "";
  // In Vercel functions the OIDC token arrives as a per-request header (and/or env in dev).
  // Verified: AI Gateway accepts it as `Authorization: Bearer` (a BYO key, if set, takes
  // precedence). https://vercel.com/docs/ai-gateway/authentication
  const oidc = process.env.VERCEL_OIDC_TOKEN || (req.headers["x-vercel-oidc-token"] as string) || "";
  const useGateway = !byoKey && !!oidc;
  const model = process.env.SIMPLY_HTML_MODEL || (useGateway ? "anthropic/claude-sonnet-4-5" : "claude-sonnet-4-5");
  const pageCap = Number(process.env.SIMPLY_HTML_LLM_PAGE_DAILY_CAP || "50");
  const globalCap = Number(process.env.SIMPLY_HTML_LLM_GLOBAL_DAILY_CAP || "500");
  if (!byoKey && !oidc) { res.status(503).json({ ok: false, error: { code: "NO_MODEL_KEY" } }); return; }

  const prompt = String(body.prompt ?? "").slice(0, 32_000);
  const system = typeof body.system === "string" ? body.system.slice(0, 4000) : undefined;
  if (!prompt.trim()) { res.status(400).json({ ok: false, error: { code: "BAD_REQUEST" } }); return; }

  // Durable caps: per-page AND global (keyed by provider identity).
  try {
    const blob = (await import("@vercel/blob")) as unknown as BlobApi;
    const idHash = createHash("sha256").update(byoKey || "gateway").digest("hex").slice(0, 16);
    if (await reserve(blob, `sh/${pageId}/_llm_usage.json`, pageCap)) { res.status(429).json({ ok: false, error: { code: "CAP", scope: "page" } }); return; }
    if (await reserve(blob, `sh/_global_llm_usage_${idHash}.json`, globalCap)) { res.status(429).json({ ok: false, error: { code: "CAP", scope: "global" } }); return; }
  } catch {
    /* counter store unavailable: proceed (soft cap), don't break the page */
  }

  try {
    let text: string;
    if (useGateway) {
      // Vercel AI Gateway: OpenAI-compatible, authenticated by the OIDC token. No key.
      const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
      const r = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${oidc}` },
        body: JSON.stringify({ model, max_tokens: 1024, messages }),
      });
      if (!r.ok) {
        res.status(502).json({ ok: false, error: { code: "MODEL_ERROR", message: `gateway ${r.status}: ${(await r.text()).slice(0, 200)}` } });
        return;
      }
      const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      text = (data.choices?.[0]?.message?.content || "").trim();
    } else {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": byoKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1024, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] }),
      });
      if (!r.ok) { res.status(502).json({ ok: false, error: { code: "MODEL_ERROR", message: `upstream ${r.status}` } }); return; }
      const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
      text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
    }
    res.status(200).json({ ok: true, text, engine: useGateway ? "vercel-gateway" : "anthropic", model });
  } catch (e) {
    res.status(502).json({ ok: false, error: { code: "MODEL_ERROR", message: (e as Error).message } });
  }
}
