// The sanitizer is the keystone safety control: it is the entire reason a model-edited
// page is safe to host behind a shared PIN. ONE config, imported by both the browser
// runtime and the Node side (CLI/function), so behavior is byte-identical in both homes.
//
// Locked decisions:
//  - DOMPurify@3 with a closed tag/attr allowlist (NOT a hand-rolled parser).
//  - The model may emit content + a closed set of data-sh-* hooks, never <script>,
//    <style>, <iframe>, event handlers, or arbitrary data-* attributes.
//  - Raster data: images only. data:image/svg+xml is dropped (deletes the SVG-script branch).

import type { Config as DomPurifyConfig } from "dompurify";

/** Content tags the model may use: the reading set + component containers. */
export const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "blockquote", "pre", "code", "kbd", "samp",
  "strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "sub", "sup",
  "br", "hr", "a", "img",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "figure", "figcaption",
  "span", "div", "section", "article", "header", "footer", "details", "summary",
];

/** Tags the model may NEVER emit. Belt to the allowlist's suspenders. */
export const FORBID_TAGS = [
  "script", "style", "iframe", "object", "embed", "link", "meta", "base",
  "form", "input", "button", "textarea", "select", "svg", "math",
  "noscript", "template", "title",
];

/** The closed data-sh-* hook set the runtime hydrates. */
export const SIMPLY_HTML_DATA_ATTRS = [
  "data-sh-id", "data-sh-block", "data-sh-component",
  "data-sh-key", "data-sh-label", "data-sh-tab",
  "data-sh-active", "data-sh-target", "data-sh-tone",
  "data-sh-min", "data-sh-max", "data-sh-step",
  "data-sh-default", "data-sh-prompt",
];

export const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "colspan", "rowspan", "scope",
  "start", "reversed", "type", "open", "dir", "lang",
  "width", "height", "loading", "id", "class",
  ...SIMPLY_HTML_DATA_ATTRS,
];

/** Raster data: images only (no svg+xml). */
export const DATA_IMAGE_REGEX =
  /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

/** http(s) / mailto / relative / anchor. NOT javascript: / generic data:. */
export const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/**
 * Class tokens permitted on model content. Anything else is stripped to block
 * CSS-exfiltration selectors under the deployed page's one `style-src 'unsafe-inline'`.
 * Final contents are pinned alongside the reading template;
 * this is the v1 starter set covering callouts + the component containers.
 */
export const SIMPLY_HTML_CLASS_ALLOWLIST = new Set<string>([
  "sh-callout", "sh-todo", "sh-list", "sh-counter",
  "sh-tabs", "sh-tab", "sh-chat-pod", "sh-note",
  "info", "success", "warn", "danger", "note",
  "task-list-item", "task-list-item-checkbox", "contains-task-list",
]);

export function buildDomPurifyConfig(): DomPurifyConfig {
  // ALLOWED_ATTR already includes SIMPLY_HTML_DATA_ATTRS, and RETURN_DOM* default to false,
  // so neither ADD_ATTR nor the RETURN_DOM* keys are needed.
  return {
    ALLOWED_TAGS,
    FORBID_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false, // model cannot smuggle arbitrary data-*
    ALLOWED_URI_REGEXP,
    KEEP_CONTENT: true,
  };
}

type PurifyLike = {
  addHook(entry: string, cb: (node: Element, data?: unknown) => void): void;
};

/**
 * Apply simply-html's invariant hooks to a DOMPurify instance:
 *  - on <img src>, accept only raster data: images (or http/relative); else drop src.
 *  - strip every on* attribute (belt+suspenders over the allowlist).
 *  - intersect class tokens against the allowlist.
 * Idempotent-safe to call once per instance.
 */
export function applyShHooks(purify: PurifyLike): void {
  purify.addHook("uponSanitizeAttribute", (node, data) => {
    const d = data as { attrName?: string; attrValue?: string; keepAttr?: boolean };
    if (!d || !d.attrName) return;
    if (d.attrName === "src" && node.tagName === "IMG") {
      const v = (d.attrValue || "").trim();
      const ok = DATA_IMAGE_REGEX.test(v) || ALLOWED_URI_REGEXP.test(v);
      if (!ok) d.keepAttr = false;
    }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    // Strip any residual event handler attributes.
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
    // Intersect class list against the allowlist.
    if (node.hasAttribute("class")) {
      const kept = (node.getAttribute("class") || "")
        .split(/\s+/)
        .filter((c) => c && SIMPLY_HTML_CLASS_ALLOWLIST.has(c));
      if (kept.length) node.setAttribute("class", kept.join(" "));
      else node.removeAttribute("class");
    }
  });
}
