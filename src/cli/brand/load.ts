// Brand file resolution + persistence. The brand file is a small JSON of tokens
// (simply-html.brand.json). Resolution order (later wins): global ~/.simply-html, cwd, the
// page's own directory — so a project can override your global look.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { homedir } from "node:os";
import type { BrandTokens } from "../../core/types.js";

export const BRAND_FILENAME = "simply-html.brand.json";

function readBrandFile(path: string): BrandTokens | null {
  try {
    const raw = readFileSync(path, "utf8");
    const obj = JSON.parse(raw) as BrandTokens;
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function candidatePaths(pageDir: string): string[] {
  return [
    join(homedir(), ".simply-html", BRAND_FILENAME),
    join(process.cwd(), BRAND_FILENAME),
    join(pageDir, BRAND_FILENAME),
  ];
}

/** Merge any brand files found, page-dir highest priority. */
export function loadBrand(pageDir: string): BrandTokens | undefined {
  let merged: BrandTokens | undefined;
  for (const p of candidatePaths(pageDir)) {
    if (existsSync(p)) {
      const t = readBrandFile(p);
      if (t) merged = { ...(merged || {}), ...t };
    }
  }
  return merged;
}

export function writeBrand(dir: string, tokens: BrandTokens): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, BRAND_FILENAME);
  const existing = existsSync(path) ? readBrandFile(path) || {} : {};
  const merged: BrandTokens = { ...existing, ...tokens };
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return path;
}

const RASTER_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export interface EmbeddedLogo {
  dataUri: string;
  bytes: number;
  warnLarge: boolean;
}

/** Encode a raster logo as a data: URI so it travels with the page (same HTML, two homes). */
export function embedLogo(path: string): EmbeddedLogo {
  const ext = extname(path).toLowerCase();
  const mime = RASTER_MIME[ext];
  if (!mime) {
    throw new Error(`logo must be a raster image (png/jpg/gif/webp); got ${ext || "no extension"}`);
  }
  const buf = readFileSync(path);
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
  return { dataUri, bytes: buf.length, warnLarge: buf.length > 512 * 1024 };
}
