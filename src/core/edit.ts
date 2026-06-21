// Apply a select-to-edit region replacement to a page's body HTML (the source of truth for
// an edited page). Node-only (uses jsdom). Sanitizes the model's replacement, splices it in
// over the addressed block run, re-stamps the new blocks, and recomputes the TOC. Returns the
// new blocks WITH their freshly-stamped ids so the client can drop them straight back in and
// keep editing them.
import { assignBlockIds, extractToc } from "./blocks.js";
import { getNodeSanitizer, parseFragment } from "./sanitize/node.js";
import type { TocEntry } from "./types.js";

export type EditResult =
  | { readonly ok: true; readonly body: string; readonly toc: readonly TocEntry[]; readonly replacement: string }
  | { readonly ok: false; readonly reason: string };

export function applyRegionEdit(bodyHtml: string, fromId: string, toId: string, rawReplacement: string): EditResult {
  const clean = getNodeSanitizer().sanitizeRegion(rawReplacement);
  if (!clean.ok) return { ok: false, reason: clean.reason };

  const body = parseFragment(bodyHtml);
  const document = body.ownerDocument!;
  const blocks = [...body.children];
  const fromIdx = blocks.findIndex((el) => el.getAttribute("data-sh-id") === fromId);
  const toIdx = blocks.findIndex((el) => el.getAttribute("data-sh-id") === toId);
  if (fromIdx < 0 || toIdx < 0 || toIdx < fromIdx) return { ok: false, reason: "region not found" };

  const staging = document.createElement("div");
  staging.innerHTML = clean.html;
  // Strip any model-supplied ids so it cannot forge/duplicate block addresses; assignBlockIds
  // restamps the new blocks with fresh, content-derived ids below.
  staging.querySelectorAll("[data-sh-id], [data-sh-block]").forEach((el) => {
    el.removeAttribute("data-sh-id");
    el.removeAttribute("data-sh-block");
  });
  const inserted = [...staging.children]; // element refs survive the move into the DOM
  if (inserted.length === 0) return { ok: false, reason: "empty replacement" };

  const anchor = blocks[fromIdx]!;
  while (staging.firstChild) anchor.parentNode!.insertBefore(staging.firstChild, anchor);
  for (let i = fromIdx; i <= toIdx; i++) blocks[i]!.remove();

  assignBlockIds(body); // existing ids are sticky; the new replacement blocks get fresh ids
  return {
    ok: true,
    body: body.innerHTML,
    toc: extractToc(body),
    replacement: inserted.map((el) => el.outerHTML).join(""),
  };
}
