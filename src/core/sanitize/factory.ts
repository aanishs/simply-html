// Build a sanitizer from a DOMPurify instance (browser window or jsdom window).
// Pure: no jsdom, no window references here, so this file is safe to bundle into the
// browser runtime. The Node side passes a jsdom-backed instance (see node.ts).

import { applyShHooks, buildDomPurifyConfig } from "./config.js";

export interface Sanitizer {
  /** Sanitize a full body-HTML string. Authoritative pass. */
  sanitizeHtml(html: string): string;
  /** Sanitize a single region's replacement HTML (model output during edits). */
  sanitizeRegion(html: string): { ok: true; html: string } | { ok: false; reason: string };
}

type PurifyInstance = {
  sanitize(dirty: string, cfg: object): string;
  addHook(entry: string, cb: (node: Element, data?: unknown) => void): void;
};

export function createSanitizer(purify: PurifyInstance): Sanitizer {
  applyShHooks(purify);
  const cfg = buildDomPurifyConfig();
  const sanitizeHtml = (html: string): string => purify.sanitize(html, cfg);
  return {
    sanitizeHtml,
    sanitizeRegion(html: string) {
      const clean = sanitizeHtml(html);
      // A region edit that the model tried to fill with script/style/etc. comes back
      // materially shorter or empty; treat an empty result on non-empty input as a reject.
      if (html.trim().length > 0 && clean.trim().length === 0) {
        return { ok: false, reason: "content blocked by sanitizer" };
      }
      return { ok: true, html: clean };
    },
  };
}
