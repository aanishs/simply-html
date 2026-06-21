// ONE long-lived local daemon that hosts MANY preview pages. Previewing N files registers N
// pages in this single process (one node runtime, one event loop, ONE shared jsdom/DOMPurify
// singleton, one global concurrency cap) instead of spawning N servers. Each page is a few KB
// of mutable state in a Map. Serves the page + the shared runtime, answers /llm (chat-pods via
// your CLI) and /__sh/edit (select-to-edit: model -> sanitize -> splice -> snapshot).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dirname, join, extname, basename } from "node:path";
import { runEngine, EngineError, ERROR_STATUS, type EngineName } from "./spawn.js";
import { applyRegionEdit } from "../../core/edit.js";
import { render } from "../../core/render/markdown.js";
import { renderPage } from "../../core/render/template.js";
import { loadBrand } from "../brand/load.js";
import type { TocEntry, PageInput } from "../../core/types.js";

interface Page {
  title: string;
  body: string;
  toc: readonly TocEntry[];
  brand: ReturnType<typeof loadBrand>;
  snapshotDir: string;
  editedPath: string; // where the edited body is persisted (survives a daemon restart)
  cachedHtml?: string; // composed page HTML, memoized between edits
}

export interface BridgeHandle {
  port: number;
  token: string;
  registerFile(id: string, filePath: string): { ok: boolean; error?: string };
  has(id: string): boolean;
  close(): Promise<void>;
}

const MAX_BODY = 256 * 1024;
const LLM_CONCURRENCY = 2; // one global cap bounds total concurrent CLI subprocesses
const MAX_PAGES = 64; // bound the registry so a long-lived daemon stays flat in memory
const EDIT_SYSTEM =
  "You are editing one region of an HTML document. Return ONLY replacement HTML for this " +
  "region, using ordinary content tags and simply-html data-sh-* component hooks. Never " +
  "emit <script>, <style>, event handlers, or any JavaScript. Output the HTML only, no fences.";

function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
function bearer(req: IncomingMessage): string | null {
  return /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? null;
}
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "", aborted = false;
    req.on("data", (c) => { raw += c; if (raw.length > MAX_BODY) { aborted = true; reject(new EngineError("BAD_REQUEST", "body too large")); req.destroy(); } });
    req.on("end", () => { if (aborted) return; try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new EngineError("BAD_REQUEST", "invalid JSON")); } });
    req.on("error", () => reject(new EngineError("BAD_REQUEST", "read error")));
  });
}
function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

export function startBridgeDaemon(opts: { port: number; token: string; engine: EngineName; runtime: Buffer; runtimeHash: string }): Promise<BridgeHandle> {
  const pages = new Map<string, Page>();
  const runtimePath = `/__sh/runtime.${opts.runtimeHash.slice(0, 12)}.js`;
  let inFlight = 0;

  const boot = (id: string): string =>
    `<script>window.__SIMPLY_HTML__=${JSON.stringify({ base: `/p/${id}`, token: opts.token, mode: "local", engine: opts.engine })};</script>`;
  const compose = (id: string, page: Page): string =>
    (page.cachedHtml ??= renderPage({ title: page.title, bodyHtml: page.body, toc: [...page.toc], brand: page.brand, headExtra: boot(id), bodyEndExtra: `<script src="${runtimePath}"></script>` }));

  const registerFile = (id: string, filePath: string): { ok: boolean; error?: string } => {
    if (!existsSync(filePath)) return { ok: false, error: "file not found" };
    const src = readFileSync(filePath, "utf8");
    const ext = extname(filePath).toLowerCase();
    const input: PageInput = ext === ".html" || ext === ".htm" ? { kind: "html", source: src } : { kind: "markdown", source: src };
    const r = render(input, basename(filePath, ext));
    const kdir = join(dirname(filePath), ".simply-html");
    const editedPath = join(kdir, "pages", `${id}.json`);
    let body = r.html;
    let toc: readonly TocEntry[] = r.toc;
    if (existsSync(editedPath)) {
      // a previous select-to-edit persisted here; restore it rather than the original render
      try {
        const saved = JSON.parse(readFileSync(editedPath, "utf8")) as { body: string; toc: TocEntry[] };
        body = saved.body;
        toc = saved.toc;
      } catch { /* corrupt snapshot: fall back to the fresh render */ }
    }
    pages.set(id, { title: r.title, body, toc, brand: loadBrand(dirname(filePath)), snapshotDir: join(kdir, "snapshots"), editedPath });
    while (pages.size > MAX_PAGES) {
      const oldest = pages.keys().next().value; // Map keeps insertion order: evict the oldest
      if (oldest === undefined) break;
      pages.delete(oldest);
    }
    return { ok: true };
  };

  const authed = (req: IncomingMessage, res: ServerResponse): boolean => {
    const tok = bearer(req);
    if (!tok || !safeEqual(tok, opts.token)) { sendJson(res, 401, { ok: false, error: { code: "BAD_TOKEN" } }); return false; }
    return true;
  };

  // Run the model and (for edit) sanitize+splice into the page body; shared by /llm and /edit.
  const runModel = async (req: IncomingMessage, res: ServerResponse, page: Page, kind: "llm" | "edit"): Promise<void> => {
    if (!authed(req, res)) return;
    let body: Record<string, unknown>;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { ok: false, error: { code: (e as EngineError).code, message: (e as Error).message } }); }
    const prompt = kind === "edit"
      ? `Here is the current HTML for one region of a document:\n\n${String(body["regionHtml"] ?? "")}\n\nApply this change: ${String(body["instruction"] ?? "")}`
      : String(body["prompt"] ?? "");
    if (!prompt.trim() || prompt.length > 64_000) return sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST" } });
    const system = kind === "edit" ? EDIT_SYSTEM : typeof body["system"] === "string" ? (body["system"] as string).slice(0, 4000) : undefined;

    // Atomic capacity reservation (synchronous, no await between check and increment).
    if (inFlight >= LLM_CONCURRENCY) return sendJson(res, 429, { ok: false, error: { code: "BRIDGE_BUSY" } });
    inFlight++;
    try {
      const r = await runEngine(opts.engine, prompt, { system });
      if (kind === "llm") return sendJson(res, 200, { ok: true, text: r.text, engine: opts.engine });
      const edit = applyRegionEdit(page.body, String(body["from"] ?? ""), String(body["to"] ?? ""), r.text);
      if (!edit.ok) return sendJson(res, 422, { ok: false, error: { code: "EDIT_FAILED", message: edit.reason } });
      mkdirSync(page.snapshotDir, { recursive: true });
      writeFileSync(join(page.snapshotDir, `snap-${Date.now()}.html`), page.body); // pre-edit (unique name)
      page.body = edit.body;
      page.toc = edit.toc;
      page.cachedHtml = undefined; // body changed: re-compose on next view
      mkdirSync(dirname(page.editedPath), { recursive: true }); // persist so a restart keeps the edit
      writeFileSync(page.editedPath, JSON.stringify({ body: page.body, toc: page.toc }));
      sendJson(res, 200, { ok: true, text: edit.replacement });
    } catch (e) {
      const err = e as EngineError;
      sendJson(res, ERROR_STATUS[err.code] ?? 502, { ok: false, error: { code: err.code ?? "CLI_ERROR", message: err.message } });
    } finally { inFlight--; }
  };

  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number } | null)?.port ?? opts.port;
    if (!hostAllowed(req, port)) return void res.writeHead(403).end("forbidden host");
    const path = (req.url ?? "/").split("?")[0]!;
    const method = req.method ?? "GET";

    if (path === runtimePath) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      return void res.end(opts.runtime);
    }
    if (path === "/__sh/health") return sendJson(res, 200, { ok: true, engine: opts.engine, pages: pages.size, runtimeHash: opts.runtimeHash });
    if (path === "/__sh/shutdown" && method === "POST") {
      if (bearer(req) !== opts.token) return sendJson(res, 401, { ok: false, error: { code: "BAD_TOKEN" } });
      sendJson(res, 200, { ok: true });
      setTimeout(() => server.close(() => process.exit(0)), 50); // let a stale daemon be replaced
      return;
    }
    if (path === "/__sh/register" && method === "POST") {
      if (bearer(req) !== opts.token) return sendJson(res, 401, { ok: false, error: { code: "BAD_TOKEN" } });
      const b = await readJson(req).catch((): Record<string, unknown> => ({}));
      const out = registerFile(String(b["id"] ?? ""), String(b["filePath"] ?? ""));
      return sendJson(res, out.ok ? 200 : 400, { ok: out.ok, error: out.error });
    }
    if (path === "/__sh/unregister" && method === "POST") {
      if (bearer(req) !== opts.token) return sendJson(res, 401, { ok: false, error: { code: "BAD_TOKEN" } });
      const b = await readJson(req).catch((): Record<string, unknown> => ({}));
      pages.delete(String(b["id"] ?? ""));
      return sendJson(res, 200, { ok: true });
    }

    // page routes: /p/:id  |  /p/:id/llm  |  /p/:id/__sh/edit
    if (path.startsWith("/p/")) {
      const rest = path.slice(3);
      const id = rest.split("/")[0]!;
      const sub = rest.slice(id.length);
      const page = pages.get(id);
      if (!page) return void res.writeHead(404).end("unknown page");
      if (sub === "" && method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
        return void res.end(compose(id, page));
      }
      if (sub === "/llm" && method === "POST") return void (await runModel(req, res, page, "llm"));
      if (sub === "/__sh/edit" && method === "POST") return void (await runModel(req, res, page, "edit"));
    }

    res.writeHead(404).end("not found");
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port, "127.0.0.1", () =>
      resolve({ port: opts.port, token: opts.token, registerFile, has: (id) => pages.has(id), close: () => new Promise((r) => server.close(() => r())) }),
    );
  });
}
