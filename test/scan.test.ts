import { describe, it, expect } from "vitest";
import { scan } from "../src/core/scan.js";

describe("pre-publish scan", () => {
  it("blocks obvious secrets", () => {
    expect(scan("AKIAIOSFODNN7EXAMPLE").blocked.length).toBeGreaterThan(0); // AWS key id
    expect(scan("key sk-ant-abcdefghijklmnopqrstuvwxyz123456").blocked.length).toBeGreaterThan(0);
    expect(scan("-----BEGIN PRIVATE KEY-----").blocked.length).toBeGreaterThan(0);
    expect(scan("token sk_live_abcdefghijklmnop1234").blocked.length).toBeGreaterThan(0);
  });

  it("warns on PHI patterns (it is a human's call)", () => {
    const r = scan("patient SSN 123-45-6789, MRN: 0099887, DOB: 03/14/1988");
    expect(r.warned.length).toBeGreaterThan(0);
  });

  it("passes clean prose with no findings", () => {
    const r = scan("# A normal document\n\nNothing sensitive here, just ordinary words about launch.");
    expect(r.blocked.length).toBe(0);
    expect(r.warned.length).toBe(0);
  });

  it("redacts the matched sample (never echoes the raw secret)", () => {
    const r = scan("AKIAIOSFODNN7EXAMPLE");
    expect(r.blocked[0]!.sample).not.toBe("AKIAIOSFODNN7EXAMPLE");
    expect(r.blocked[0]!.sample).toContain("…");
    expect(r.blocked[0]!.line).toBe(1);
  });
});
