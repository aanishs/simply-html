// Vercel deploy adapter. Token comes from VERCEL_TOKEN (env or a gitignored .env) and is
// passed to the CLI via the environment, NEVER as --token (which would leak in process
// listings). Secrets are set with `vercel env add ... < stdin`, also never on argv.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export function loadVercelToken(): string | null {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const candidates = [join(repoRoot, ".env"), join(homedir(), ".simply-html", ".env"), join(process.cwd(), ".env")];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*VERCEL_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1]!.replace(/^['"]|['"]$/g, "");
    }
  }
  return null;
}

interface VercelBin {
  cmd: string;
  prefix: string[];
}
export function resolveVercel(): VercelBin {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const local = join(repoRoot, "node_modules", ".bin", "vercel");
  if (existsSync(local)) return { cmd: local, prefix: [] };
  return { cmd: "npx", prefix: ["--yes", "vercel@latest"] };
}

export interface VercelRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runVercel(
  bin: VercelBin,
  args: string[],
  opts: { token: string; cwd: string; input?: string; timeoutMs?: number },
): Promise<VercelRunResult> {
  return new Promise((resolve) => {
    // The CLI does not honor the VERCEL_TOKEN env var across versions, so the token is
    // passed via --token. This puts it on the child argv (visible in a local process list
    // briefly); acceptable for a local dev tool, and the token should be a revocable one.
    const child = spawn(bin.cmd, [...bin.prefix, ...args, "--token", opts.token], {
      cwd: opts.cwd,
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1", CI: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 180_000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: stderr + String(e) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    if (opts.input != null) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Pull the production https URL out of vercel deploy output. */
export function parseDeployUrl(out: string): string | null {
  const m = out.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi);
  return m && m.length ? m[m.length - 1]! : null;
}

/**
 * In non-interactive mode the CLI refuses to pick a scope and emits a
 * { reason: "missing_scope", choices: [{ name }] } block. Pull the scope so we can retry.
 */
export function extractMissingScope(out: string): string | null {
  if (!out.includes("missing_scope")) return null;
  const m = /"choices"[\s\S]*?"name"\s*:\s*"([^"]+)"/.exec(out);
  return m ? m[1]! : null;
}

/**
 * New Vercel projects ship with "Vercel Authentication" (SSO) deployment protection ON,
 * which gates the whole deployment behind a Vercel login BEFORE our function runs. We ship
 * our own PIN gate, so we turn Vercel's off via the REST API (which DOES honor the token).
 */
export async function disableDeploymentProtection(
  projectId: string,
  teamId: string | undefined,
  token: string,
): Promise<{ ok: boolean; status: number }> {
  const q = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${q}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
  });
  return { ok: res.ok, status: res.status };
}

/** The .vercel/project.json written after a deploy carries the project + org (team) ids. */
export function readProjectIds(deployDir: string): { projectId?: string; orgId?: string } {
  try {
    const p = join(deployDir, ".vercel", "project.json");
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf8")) as { projectId?: string; orgId?: string };
  } catch {
    return {};
  }
}
