// Persistent config for the standalone `simply-html bridge` daemon: a fixed port + a token,
// stored at ~/.simply-html/bridge.json. The token gates the bridge so a random site you visit
// can't POST to your localhost and run your CLI; your published pages get the token baked in.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export interface BridgeConfig {
  port: number;
  token: string;
}

export const DEFAULT_BRIDGE_PORT = 4319;

function configPath(): string {
  return join(homedir(), ".simply-html", "bridge.json");
}

export function readBridgeConfig(): BridgeConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  try {
    const c = JSON.parse(readFileSync(p, "utf8")) as BridgeConfig;
    if (c && typeof c.port === "number" && typeof c.token === "string") return c;
  } catch {
    /* fall through */
  }
  return null;
}

/** Load the config, creating it (with a fresh token) on first run. */
export function loadOrCreateBridgeConfig(port?: number): BridgeConfig {
  const existing = readBridgeConfig();
  if (existing && (!port || existing.port === port)) return existing;
  const cfg: BridgeConfig = { port: port || existing?.port || DEFAULT_BRIDGE_PORT, token: existing?.token || randomBytes(24).toString("base64url") };
  const dir = join(homedir(), ".simply-html");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(cfg, null, 2) + "\n";
  if (existing) {
    // explicit overwrite (e.g. a port change) — no first-run race here
    writeFileSync(configPath(), body, { mode: 0o600 });
    return cfg;
  }
  try {
    // exclusive create: if two first-run previews race, only one wins; the loser re-reads.
    writeFileSync(configPath(), body, { mode: 0o600, flag: "wx" });
    return cfg;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      const winner = readBridgeConfig();
      if (winner) return winner;
    }
    writeFileSync(configPath(), body, { mode: 0o600 });
    return cfg;
  }
}
