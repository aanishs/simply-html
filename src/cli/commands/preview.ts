// `simply-html preview <file>` — register the file as a page on the shared bridge daemon and
// print its URL. The daemon (one process, started on first use) hosts ALL preview pages, so
// previewing more files costs a few KB each, not another process.
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { loadOrCreateBridgeConfig, type BridgeConfig } from "../bridge/config.js";
import { line, note, fail } from "../output.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The hash of the runtime bundle this build expects the daemon to be serving. */
function currentRuntimeHash(): string {
  const sha = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "runtime.sha256");
  return existsSync(sha) ? readFileSync(sha, "utf8").trim() : "dev";
}

async function health(port: number): Promise<{ runtimeHash?: string } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/__sh/health`);
    return r.ok ? ((await r.json()) as { runtimeHash?: string }) : null;
  } catch {
    return null;
  }
}

/** Ensure a daemon running THIS build's runtime is listening; (re)spawn detached if needed. */
async function ensureDaemon(): Promise<BridgeConfig> {
  const want = currentRuntimeHash();
  const cfg = loadOrCreateBridgeConfig();
  const live = await health(cfg.port);
  if (live && live.runtimeHash === want) return cfg;

  if (live) {
    // a stale daemon from an older build is holding the port — shut it down first
    note("Restarting the simply-html bridge (runtime changed since it started)…");
    await fetch(`http://127.0.0.1:${cfg.port}/__sh/shutdown`, { method: "POST", headers: { authorization: `Bearer ${cfg.token}` } }).catch(() => {});
    for (let i = 0; i < 30 && (await health(cfg.port)) !== null; i++) await sleep(100);
  }

  const cli = fileURLToPath(import.meta.url); // dist/cli/index.js (bundled)
  spawn(process.execPath, [cli, "bridge"], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 60; i++) {
    if (await health(cfg.port)) return loadOrCreateBridgeConfig(); // re-read in case the daemon wrote it
    await sleep(100);
  }
  fail("could not start the simply-html bridge daemon (is the runtime built? run `npm run build`).");
}

export async function previewCommand(file: string): Promise<void> {
  if (!existsSync(file)) fail(`file not found: ${file}`);
  const abs = resolve(file);
  const id = createHash("sha1").update(abs).digest("base64url").slice(0, 10);
  const { port, token } = await ensureDaemon();

  const res = await fetch(`http://127.0.0.1:${port}/__sh/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, filePath: abs }),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !data?.ok) fail(`register failed: ${data?.error ?? res.status}`);

  line("URL", `http://127.0.0.1:${port}/p/${id}`);
  note(`Serving ${file} on the shared bridge (background). Run \`simply-html bridge\` to watch logs.`);
}
