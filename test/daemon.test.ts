import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startBridgeDaemon, type BridgeHandle } from "../src/cli/bridge/server.js";

const PORT = 14913;
const TOKEN = "testtoken1234567890";
const HASH = "abcdef1234567890";
let daemon: BridgeHandle;
let dir: string;
let file: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sh-daemon-"));
  file = join(dir, "doc.md");
  writeFileSync(file, "# Hello Daemon\n\nA paragraph here.");
  daemon = await startBridgeDaemon({ port: PORT, token: TOKEN, engine: "claude", runtime: Buffer.from("/* runtime bundle */"), runtimeHash: HASH });
});
afterAll(async () => {
  await daemon.close();
  rmSync(dir, { recursive: true, force: true });
});

const base = `http://127.0.0.1:${PORT}`;

describe("bridge daemon (shared, multi-page)", () => {
  it("registers a file and serves the composed page at /p/:id", async () => {
    expect(daemon.registerFile("pg1", file).ok).toBe(true);
    const r = await fetch(`${base}/p/pg1`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<title>Hello Daemon</title>");
    expect(html).toContain("A paragraph here.");
  });

  it("hosts multiple pages in the one process", async () => {
    daemon.registerFile("pg2", file);
    expect((await fetch(`${base}/p/pg1`)).status).toBe(200);
    expect((await fetch(`${base}/p/pg2`)).status).toBe(200);
  });

  it("404s an unknown page", async () => {
    expect((await fetch(`${base}/p/nope`)).status).toBe(404);
  });

  it("serves the shared runtime bundle at the hashed path", async () => {
    const r = await fetch(`${base}/__sh/runtime.abcdef123456.js`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("runtime bundle");
  });

  it("requires the token for /edit", async () => {
    const r = await fetch(`${base}/p/pg1/__sh/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
  });

  it("health reports the page count + runtime hash (for stale-restart detection)", async () => {
    const j = (await (await fetch(`${base}/__sh/health`)).json()) as { ok: boolean; runtimeHash: string; pages: number };
    expect(j.ok).toBe(true);
    expect(j.runtimeHash).toBe(HASH);
    expect(j.pages).toBeGreaterThanOrEqual(2);
  });
});
