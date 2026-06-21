// `simply-html bridge` — run the shared local daemon (foreground) that hosts all preview pages
// in one process. `simply-html preview` starts this automatically on first use; run it yourself
// to watch logs / keep it alive.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateBridgeConfig } from "../bridge/config.js";
import { startBridgeDaemon } from "../bridge/server.js";
import { detectEngine } from "../engine.js";
import { line, note, fail } from "../output.js";

function loadRuntime(): { bytes: Buffer; hash: string } {
  const dist = join(dirname(fileURLToPath(import.meta.url)), ".."); // dist/cli -> dist
  const file = join(dist, "runtime", "runtime.js");
  if (!existsSync(file)) fail("runtime bundle missing — run `npm run build` first.");
  const sha = join(dist, "runtime", "runtime.sha256");
  return { bytes: readFileSync(file), hash: existsSync(sha) ? readFileSync(sha, "utf8").trim() : "dev" };
}

export async function bridgeCommand(opts: { port?: string }): Promise<void> {
  const cfg = loadOrCreateBridgeConfig(opts.port ? Number(opts.port) : undefined);
  const engine = detectEngine();
  if (!engine.available) fail("no agent CLI found on PATH. Install the Claude CLI (or codex) first.");
  const { bytes, hash } = loadRuntime();
  const daemon = await startBridgeDaemon({ port: cfg.port, token: cfg.token, engine: engine.engine, runtime: bytes, runtimeHash: hash });

  note("simply-html bridge running — it hosts all your preview pages in this one process.");
  line("Bridge", `http://127.0.0.1:${daemon.port}  engine=${engine.engine}`);
  note("Run `simply-html preview <file>` (in another terminal) to add pages. Ctrl+C to stop.");
  await new Promise<void>((resolve) => {
    process.on("SIGINT", async () => { await daemon.close(); resolve(); });
  });
}
