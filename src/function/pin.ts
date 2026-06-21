// PIN crypto for the deployed gate. scrypt hash + constant-time compare; the PIN is never
// stored plaintext and never shipped to the client. Hash + salt live as function env vars.
import { scryptSync, randomBytes, timingSafeEqual, randomInt } from "node:crypto";

const N = 16384, r = 8, p = 1, KEYLEN = 32;

export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashPin(pin: string, saltHex: string): string {
  return scryptSync(pin, Buffer.from(saltHex, "hex"), KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 }).toString("hex");
}

export function verifyPin(pin: string, saltHex: string, hashHex: string): boolean {
  let got: Buffer;
  try {
    got = scryptSync(pin, Buffer.from(saltHex, "hex"), KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  } catch {
    return false;
  }
  const want = Buffer.from(hashHex, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Cryptographically-random numeric PIN of the given length (4 or 6). */
export function generatePin(digits: number): string {
  let s = "";
  for (let i = 0; i < digits; i++) s += randomInt(0, 10).toString();
  return s;
}
