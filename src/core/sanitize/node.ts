// Node-only DOM: a single jsdom window built once per process, shared by the DOMPurify
// sanitizer AND the renderer/editor's HTML parsing. jsdom only PARSES, never executes.
// This file imports jsdom, so it must never be pulled into the browser runtime bundle
// (the runtime imports factory.ts directly).

import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { createSanitizer, type Sanitizer } from "./factory.js";

let cachedWindow: (Window & typeof globalThis) | undefined;
function win(): Window & typeof globalThis {
  return (cachedWindow ??= new JSDOM("").window as unknown as Window & typeof globalThis);
}

let cached: Sanitizer | null = null;
export function getNodeSanitizer(): Sanitizer {
  if (cached) return cached;
  // DOMPurify's factory accepts a window-like object (jsdom's window qualifies at runtime).
  const purify = createDOMPurify(win() as unknown as Parameters<typeof createDOMPurify>[0]);
  cached = createSanitizer(purify as never);
  return cached;
}

/**
 * Parse a fragment of HTML into a detached body element using the ONE cached jsdom
 * document — so render() and applyRegionEdit() stop allocating a fresh JSDOM (the single
 * heaviest allocation in those hot paths). Safe because the bridge is single-event-loop and
 * serializes render/edit: the caller must read body.innerHTML before the next parse reuses
 * the document. DOMPurify parses into its own template, so it never collides with this body.
 */
export function parseFragment(html: string): HTMLElement {
  const { document } = win();
  document.body.innerHTML = html;
  return document.body;
}
