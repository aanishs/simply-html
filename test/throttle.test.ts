import { describe, it, expect } from "vitest";
import { isThrottled, recordFail, recordOk } from "../src/function/throttle.js";

// Exercises the best-effort (in-memory) branch — durable=false — which is the read-only
// page path. The durable Blob branch is covered by the deployed integration suite.
const id = () => `pg-${Math.random().toString(36).slice(2)}`;

describe("PIN throttle (best-effort branch)", () => {
  it("does not lock out before 6 fails", async () => {
    const p = id();
    for (let i = 0; i < 5; i++) await recordFail(p, Date.now(), false);
    expect(await isThrottled(p, Date.now(), false)).toBe(false);
  });

  it("locks out after 6 fails and clears on success", async () => {
    const p = id();
    const now = Date.now();
    for (let i = 0; i < 6; i++) await recordFail(p, now, false);
    expect(await isThrottled(p, now, false)).toBe(true);
    await recordOk(p, false);
    expect(await isThrottled(p, now, false)).toBe(false);
  });

  it("escalates to a 10-minute lockout after 20 fails", async () => {
    const p = id();
    const now = Date.now();
    for (let i = 0; i < 20; i++) await recordFail(p, now, false);
    expect(await isThrottled(p, now, false)).toBe(true);
    expect(await isThrottled(p, now + 9 * 60_000, false)).toBe(true); // still locked at 9 min
    expect(await isThrottled(p, now + 11 * 60_000, false)).toBe(false); // free after 10 min
  });

  it("is isolated per page id", async () => {
    const a = id();
    const b = id();
    const now = Date.now();
    for (let i = 0; i < 6; i++) await recordFail(a, now, false);
    expect(await isThrottled(a, now, false)).toBe(true);
    expect(await isThrottled(b, now, false)).toBe(false);
  });
});
