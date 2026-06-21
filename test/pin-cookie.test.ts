import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, generateSalt, generatePin } from "../src/function/pin.js";
import { signSession, verifySession, MAX_AGE_SEC } from "../src/function/cookie.js";

describe("PIN crypto", () => {
  it("verifies the right PIN and rejects the wrong one", () => {
    const salt = generateSalt();
    const hash = hashPin("4827", salt);
    expect(verifyPin("4827", salt, hash)).toBe(true);
    expect(verifyPin("0000", salt, hash)).toBe(false);
  });
  it("never stores the PIN in the hash", () => {
    const salt = generateSalt();
    const hash = hashPin("123456", salt);
    expect(hash).not.toContain("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("generates numeric PINs of the requested length", () => {
    expect(generatePin(4)).toMatch(/^\d{4}$/);
    expect(generatePin(6)).toMatch(/^\d{6}$/);
  });
});

describe("session cookie", () => {
  const secret = "s".repeat(64);
  const now = 1_750_000_000_000;
  it("round-trips a valid session", () => {
    const c = signSession({ pageId: "p1", iat: now, exp: now + MAX_AGE_SEC * 1000 }, secret);
    const s = verifySession(c, secret, now + 1000);
    expect(s?.pageId).toBe("p1");
  });
  it("rejects a tampered payload", () => {
    const c = signSession({ pageId: "p1", iat: now, exp: now + 1000 }, secret);
    const tampered = c.replace(/^[^.]+/, Buffer.from('{"pageId":"evil","iat":0,"exp":9999999999999}').toString("base64url"));
    expect(verifySession(tampered, secret, now)).toBeNull();
  });
  it("rejects a wrong signing secret (revocation path)", () => {
    const c = signSession({ pageId: "p1", iat: now, exp: now + 1000 }, secret);
    expect(verifySession(c, "different".repeat(8), now)).toBeNull();
  });
  it("rejects an expired session", () => {
    const c = signSession({ pageId: "p1", iat: now, exp: now + 1000 }, secret);
    expect(verifySession(c, secret, now + 5000)).toBeNull();
  });
});
