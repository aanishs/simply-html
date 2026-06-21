import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// Point ~ at a throwaway dir so the test never touches the user's real ~/.simply-html.
const HOME = join("/tmp", `sh-cfg-test-${process.pid}`);
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => HOME };
});

const { loadOrCreateBridgeConfig, readBridgeConfig } = await import("../src/cli/bridge/config.js");

const reset = (): void => rmSync(HOME, { recursive: true, force: true });

describe("bridge config", () => {
  beforeEach(reset);
  afterEach(reset);

  it("creates a config with the default port + a token on first run", () => {
    const cfg = loadOrCreateBridgeConfig();
    expect(cfg.port).toBe(4319);
    expect(cfg.token.length).toBeGreaterThan(20);
    expect(existsSync(join(HOME, ".simply-html", "bridge.json"))).toBe(true);
  });

  it("returns the SAME token on a second load (no churn / no token mismatch)", () => {
    const a = loadOrCreateBridgeConfig();
    const b = loadOrCreateBridgeConfig();
    expect(b.token).toBe(a.token);
    expect(readBridgeConfig()?.token).toBe(a.token);
  });

  it("writes the config file 0600", () => {
    loadOrCreateBridgeConfig();
    const mode = statSync(join(HOME, ".simply-html", "bridge.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
