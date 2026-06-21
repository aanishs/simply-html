// Lock the subprocess env policy: the model CLI inherits enough to stay logged in, but
// app/cloud secrets never leak into it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scrubbedEnv } from "../src/cli/bridge/spawn.js";

const ADDED = ["AWS_SECRET_ACCESS_KEY", "STRIPE_SECRET_KEY", "MY_APP_TOKEN", "DATABASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR"];

describe("scrubbedEnv", () => {
  beforeEach(() => {
    process.env.AWS_SECRET_ACCESS_KEY = "AKIAsecret";
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    process.env.MY_APP_TOKEN = "tok_x";
    process.env.DATABASE_URL = "postgres://x";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.CLAUDE_CONFIG_DIR = "/home/u/.claude";
  });
  afterEach(() => {
    for (const k of ADDED) delete process.env[k];
  });

  it("drops cloud/app secrets", () => {
    const env = scrubbedEnv();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.MY_APP_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("keeps engine auth + PATH/HOME so the CLI stays logged in", () => {
    const env = scrubbedEnv();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-x");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude");
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
  });
});
