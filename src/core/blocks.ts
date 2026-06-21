// Stable, content-derived block ids + TOC extraction. DOM-API only (no jsdom/window
// import) so the SAME code runs in the Node renderer (jsdom document) and the browser
// runtime (real document) for select-to-edit. Ids are sticky-once-written: once stamped
// into stored HTML they are preserved, so later text edits do not reshuffle them.

import type { TocEntry } from "./types.js";

const BLOCK_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "BLOCKQUOTE", "PRE", "UL", "OL",
  "DL", "TABLE", "FIGURE", "HR", "SECTION", "ARTICLE", "DETAILS", "HEADER", "FOOTER",
]);

/** FNV-1a 32-bit, returned as base36. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function normalizedText(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function isBlock(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName) || el.hasAttribute("data-sh-component");
}

/**
 * Stamp data-sh-id on each top-level flow block (and each component container)
 * that lacks one. Returns the block ids in document order.
 */
export function assignBlockIds(root: Element): string[] {
  const ids: string[] = [];
  const seen = new Map<string, number>();
  const children = Array.from(root.children);
  for (const el of children) {
    if (!isBlock(el)) continue;
    let id = el.getAttribute("data-sh-id");
    if (!id) {
      const base = `${el.tagName}:${normalizedText(el)}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      id = "k_" + fnv1a(`${base}#${n}`);
      el.setAttribute("data-sh-id", id);
    }
    if (!el.hasAttribute("data-sh-block")) {
      el.setAttribute("data-sh-block", "1");
    }
    ids.push(id);
  }
  return ids;
}

/** Build the right-rail TOC from h2/h3 that already carry ids (markdown-it-anchor). */
export function extractToc(root: Element): TocEntry[] {
  const toc: TocEntry[] = [];
  const headings = root.querySelectorAll("h2[id], h3[id]");
  headings.forEach((h) => {
    const level = h.tagName === "H2" ? 2 : 3;
    toc.push({ level, id: h.id, text: (h.textContent || "").trim() });
  });
  return toc;
}

/** First h1 text, or null. */
export function firstHeading(root: Element): string | null {
  const h1 = root.querySelector("h1");
  return h1 ? (h1.textContent || "").trim() || null : null;
}
