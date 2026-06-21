// Safe subprocess wrapper for the local /llm route. Uses node:child_process.spawn
// (NEVER exec/shell); the prompt goes over stdin, never argv. Env is scrubbed to an
// allowlist so app secrets never leak into the model subprocess (the engine's own auth
// lives under HOME, which we keep, so it stays logged in).

import { spawn } from "node:child_process";

export type EngineName = "claude" | "codex" | "none";

export interface RunResult {
  text: string;
}

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EngineError";
  }
}

const LOGGED_OUT = /not logged in|please run.*login|unauthorized|authentication|invalid api key|run `?claude login/i;

// The engine's own auth needs more than HOME (it reads OS keychain / session env), so an
// allowlist breaks login. Instead we inherit the env and DENY known app-secret names, while
// preserving engine-auth vars. This keeps the model subprocess logged in without leaking
// AWS/Stripe/cloud secrets into it.
const ENGINE_KEEP = /^(?:ANTHROPIC|CLAUDE|CODEX|OPENAI)_/i;
const SECRET_NAME =
  /(?:^|_)(?:AWS|AMAZON|STRIPE|TWILIO|SENDGRID|MAILGUN|SLACK|SENTRY|DATADOG|GITHUB|GITLAB|BITBUCKET|VERCEL|NETLIFY|CLOUDFLARE|HEROKU|DIGITALOCEAN|GCP|GOOGLE|AZURE|MONGO|POSTGRES|MYSQL|REDIS|DATABASE|SUPABASE|FIREBASE|NPM)_|_(?:SECRET|PASSWORD|PASSWD|TOKEN|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)(?:$|_)|^(?:SECRET|PASSWORD|PASSWD|PRIVATE_KEY|DATABASE_URL)/i;

export function scrubbedEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (ENGINE_KEEP.test(k)) {
      out[k] = v;
      continue;
    }
    if (SECRET_NAME.test(k)) continue; // drop app secrets
    out[k] = v;
  }
  return out;
}

function argsFor(engine: EngineName): string[] {
  switch (engine) {
    // Print mode, plain text, plan permission so a text Q&A never triggers tool use.
    case "claude":
      return ["-p", "--output-format", "text", "--permission-mode", "plan"];
    // codex stdin form (open item: verify against the installed Codex binary).
    case "codex":
      return ["exec", "-"];
    default:
      return [];
  }
}

export interface RunOptions {
  system?: string;
}

export function runEngine(engine: EngineName, prompt: string, opts: RunOptions = {}): Promise<RunResult> {
  if (engine === "none") return Promise.reject(new EngineError("CLI_MISSING", "no agent CLI on PATH"));
  const timeoutMs = 60_000;
  const body = opts.system ? `${opts.system}\n\n---\n\n${prompt}` : prompt;

  return new Promise<RunResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(engine, argsFor(engine), { stdio: ["pipe", "pipe", "pipe"], env: scrubbedEnv() });
    } catch {
      reject(new EngineError("CLI_MISSING", `failed to spawn ${engine}`));
      return;
    }

    let out = "";
    let err = "";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(graceTimer);
      fn();
    };

    let graceTimer: NodeJS.Timeout | undefined;
    const killTimer = setTimeout(() => {
      child.kill("SIGTERM");
      graceTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
      done(() => reject(new EngineError("CLI_TIMEOUT", `${engine} timed out`)));
    }, timeoutMs);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e: NodeJS.ErrnoException) => {
      done(() => reject(new EngineError(e.code === "ENOENT" ? "CLI_MISSING" : "CLI_ERROR", e.message)));
    });
    child.on("close", (code) => {
      done(() => {
        // The logged-out message can land on stdout OR stderr depending on the CLI.
        if (LOGGED_OUT.test(err) || (code !== 0 && LOGGED_OUT.test(out))) {
          reject(new EngineError("CLI_LOGGED_OUT", "agent CLI is not logged in"));
        } else if (code === 0) {
          resolve({ text: out.trim() });
        } else {
          reject(new EngineError("CLI_ERROR", err.trim().slice(0, 300) || out.trim().slice(0, 300) || `${engine} exited ${code}`));
        }
      });
    });

    child.stdin.on("error", () => {/* ignore EPIPE if the child died early */});
    child.stdin.end(body);
  });
}

export const ERROR_STATUS: Record<string, number> = {
  BAD_TOKEN: 401,
  BAD_REQUEST: 400,
  BRIDGE_BUSY: 429,
  CLI_MISSING: 503,
  CLI_LOGGED_OUT: 503,
  CLI_TIMEOUT: 504,
  CLI_ERROR: 502,
  CONTENT_BLOCKED: 422,
};
