// Browser-side /llm client. The page is always served by its own endpoint — the local
// preview bridge (your CLI, free) or the deployed function (gateway/key) — so it posts to
// that one origin. No public->localhost path exists: browsers block it, and the model only
// ever sees content the page already trusts.

export type LlmResult =
  | { ok: true; text: string; via: "local" | "remote" }
  | { ok: false; code: string; message: string };

const OFFLINE_COPY: Record<string, string> = {
  OFFLINE: "LLM offline — run `simply-html bridge` (or add a key/gateway).",
  CLI_MISSING: "No agent CLI found — install the Claude CLI.",
  CLI_LOGGED_OUT: "Agent CLI not logged in — run `claude login`.",
  CLI_TIMEOUT: "The model timed out. Try again.",
  BRIDGE_BUSY: "Bridge busy — try again in a moment.",
  CONTENT_BLOCKED: "That edit was blocked by the sanitizer.",
  BAD_TOKEN: "Session token rejected. Reload the page.",
  NO_MODEL_KEY: "No model available — run `simply-html bridge`, or enable the gateway/key.",
};

export function offlineMessage(code: string, fallback?: string): string {
  return OFFLINE_COPY[code] || fallback || "The model is unavailable right now.";
}

async function callEndpoint(
  url: string,
  token: string | undefined,
  prompt: string,
  opts: { system?: string },
  timeoutMs: number,
): Promise<{ ok: true; text: string } | { ok: false; code: string; message?: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ prompt, system: opts.system }), signal: ctl.signal });
  } catch {
    return { ok: false, code: "OFFLINE" };
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: { code?: string; message?: string } } | null;
  if (res.ok && data?.ok) return { ok: true, text: data.text || "" };
  return { ok: false, code: data?.error?.code || "CLI_ERROR", message: data?.error?.message };
}

export async function askLLM(prompt: string, opts: { system?: string } = {}): Promise<LlmResult> {
  const K = window.__SIMPLY_HTML__;
  if (!K) return { ok: false, code: "OFFLINE", message: offlineMessage("OFFLINE") };
  const r = await callEndpoint(`${K.base}/llm`, K.token, prompt, opts, 90_000);
  if (r.ok) return { ok: true, text: r.text, via: K.mode === "local" ? "local" : "remote" };
  return { ok: false, code: r.code, message: offlineMessage(r.code, r.message) };
}
