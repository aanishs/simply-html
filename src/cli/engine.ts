// Lightweight detection of the local agent CLI used by the bridge's /llm route.
// Non-blocking: scans PATH for the binary instead of spawning it.
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface EngineInfo {
  engine: "claude" | "codex" | "none";
  available: boolean;
}

function onPath(bin: string): boolean {
  const path = process.env.PATH || "";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of path.split(process.platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of exts) {
      if (existsSync(join(dir, bin + ext))) return true;
    }
  }
  return false;
}

export function detectEngine(): EngineInfo {
  if (onPath("claude")) return { engine: "claude", available: true };
  if (onPath("codex")) return { engine: "codex", available: true };
  return { engine: "none", available: false };
}
