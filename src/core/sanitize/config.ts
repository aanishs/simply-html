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

/** Content tags the model may use: the reading set + component containers + inert form controls. */
export const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "blockquote", "pre", "code", "kbd", "samp",
  "strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "sub", "sup",
  "br", "hr", "a", "img",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "figure", "figcaption",
  "span", "div", "section", "article", "header", "footer", "details", "summary",
  // Interactive controls for substrate apps. SAFE because they are INERT without the runtime:
  // there is no <form> (so no submit/navigation), every on* handler is stripped, and form-action
  // attributes are not in the allowlist. Only the sandboxed runtime (data-sh-bind / data-sh-on)
  // ever animates them.
  "button", "input", "textarea", "label",
  // SVG DRAWING SUBSET — declarative shape/paint elements only, so the model can draw a custom
  // chart/diagram as content. EXCLUDED on purpose (script vectors): <script>, <foreignObject>
  // (embeds HTML), <style>, <use>/<image>/<a> (href smuggling), and the <animate>/<set>/
  // <animateTransform>/<animateMotion> SMIL family (can animate an attribute INTO javascript:).
  // on* is stripped, hrefs are URL-checked, and FORBID_TAGS below hard-blocks the dangerous ones.
  "svg", "g", "defs", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "lineargradient", "radialgradient", "stop", "clippath",
];

/** Tags the model may NEVER emit. Belt to the allowlist's suspenders. (<form>/<select> stay out.) */
export const FORBID_TAGS = [
  "script", "style", "iframe", "object", "embed", "link", "meta", "base",
  "form", "select", "math",
  "noscript", "template", "title",
  // SVG script vectors — hard-blocked even though they're already absent from ALLOWED_TAGS.
  // (NOT <a> — it's shared with HTML anchors; SVG <a>'s xlink:href is URL-validated anyway.)
  "foreignobject", "use", "image",
  "animate", "animatetransform", "animatemotion", "set", "mpath", "filter",
];

/** Interactive tags only meaningful inside a substrate app; allowed but inert elsewhere. */
export const SIMPLY_HTML_INTERACTIVE_TAGS = new Set<string>(["BUTTON", "INPUT", "TEXTAREA", "LABEL"]);

/** `<input type>` values that are safe on a JS-free page. `image`/`file` are coerced to `text`. */
export const SIMPLY_HTML_SAFE_INPUT_TYPES = new Set<string>([
  "text", "checkbox", "radio", "number", "search", "email", "url", "tel",
  "date", "time", "datetime-local", "month", "week", "range", "color", "password", "hidden",
  "button", "submit", "reset",
]);

/** The closed data-sh-* hook set the runtime hydrates. */
export const SIMPLY_HTML_DATA_ATTRS = [
  "data-sh-id", "data-sh-block", "data-sh-component",
  "data-sh-key", "data-sh-label", "data-sh-tab",
  "data-sh-active", "data-sh-target", "data-sh-tone",
  "data-sh-min", "data-sh-max", "data-sh-step",
  "data-sh-default", "data-sh-prompt",
  // substrate (reactive [data-sh-app] regions): structural + binding directives. Each value is
  // either pure data (JSON state) or a read-only sandboxed formula / a closed action call —
  // never executable on its own; only the audited runtime interprets them.
  "data-sh-app", "data-sh-state", "data-sh-ready",
  "data-sh-text", "data-sh-show", "data-sh-class",
  "data-sh-repeat", "data-sh-as", "data-sh-index", "data-sh-on", "data-sh-bind",
  "data-sh-def", "data-sh-use", // reusable components (def template + use site)
  "data-sh-chart", "data-sh-values", "data-sh-labels", "data-sh-max", // reactive SVG charts
];

/**
 * Targets a `data-sh-attr-<name>` reactive binding may write. This is a security policy, not a
 * convenience list: it deliberately excludes `on*`, `style`, `class`, and every event/script
 * bearing attribute, so a reactive attribute can never promote authored markup into executable
 * code. Shared by the sanitizer (which keeps `data-sh-attr-<safe>` and drops the rest) and the
 * runtime (which refuses to bind anything outside it, and value-checks the URL targets).
 */
export const SIMPLY_HTML_ATTR_BIND_TARGETS = new Set<string>([
  // NOTE: `id` is intentionally excluded — a reactive, model-controlled id is a latent DOM-clobbering
  // surface (it could collide with the data-sh-ready sentinel or document properties).
  "href", "src", "alt", "title", "colspan", "rowspan", "scope",
  "start", "reversed", "open", "dir", "lang", "width", "height", "loading", "role",
  "aria-label", "aria-hidden", "aria-live", "aria-expanded", "aria-current", "aria-disabled",
  // SVG geometry/paint — so a hand-drawn chart can bind a shape's size/position/colour to state.
  // All are pure drawing values (no script vector); `href`/`xlink:href` are NOT here.
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "opacity",
  "fill-opacity", "offset", "stop-color",
]);

/** The subset of bind targets whose value is a URL and must pass the URL allowlist at bind time. */
export const SIMPLY_HTML_URL_BIND_TARGETS = new Set<string>(["href", "src"]);

/**
 * Bind targets that are SVG presentation attributes. Their value is checked with `isSafeSvgValue`
 * at bind time so a reactive paint (`fill`/`stroke`/`stop-color`) can't splice an external
 * `url(<iri>)` funciri — a paint-server reference that fires an off-page request — into the DOM.
 * Geometry targets (x/d/points/…) never carry a `url()` so the check is a free no-op for them.
 */
export const SIMPLY_HTML_SVG_BIND_TARGETS = new Set<string>([
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "opacity",
  "fill-opacity", "offset", "stop-color",
]);

/**
 * An SVG presentation value is safe iff every `url(...)` funciri it contains points only at a
 * local `#fragment` (a gradient/clip ref). An external `url(https://…)` in `fill`/`stroke`/
 * `clip-path` fires an off-page GET — an exfil/beacon channel that needs no script — so it is
 * rejected. Pure geometry/colour values contain no `url(` and pass untouched. Used by the
 * sanitizer (static SVG attrs) and the runtime (reactive `data-sh-attr-*` paints).
 */
export function isSafeSvgValue(value: string): boolean {
  const refs = value.match(/url\([^)]*\)/gi);
  if (!refs) return true;
  return refs.every((ref) => /^url\(\s*['"]?\s*#/i.test(ref));
}

/** O(1) lookup of the closed hook set, used by the sanitizer to force-keep our inert directives. */
const SH_DIRECTIVE_SET = new Set<string>(SIMPLY_HTML_DATA_ATTRS);

/**
 * SVG presentation/geometry attributes — pure drawing data, no script vectors. Lowercase because
 * DOMPurify compares lowercased attribute names (it preserves the source casing in the output, so
 * `viewBox` stays `viewBox`). Deliberately EXCLUDES `href`/`xlink:href` (URL smuggling), `style`
 * (no model CSS), and any `on*` (stripped).
 */
export const SIMPLY_HTML_SVG_ATTRS = [
  "viewbox", "preserveaspectratio", "transform", "d", "points",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity",
  "text-anchor", "dominant-baseline", "font-size", "font-family", "font-weight", "dx", "dy",
  "vector-effect", "clip-path", "gradientunits", "gradienttransform", "offset",
  "stop-color", "stop-opacity",
];

/** O(1) lookup of the SVG presentation attrs, so the sanitizer can value-check their funciri. */
const SH_SVG_ATTR_SET = new Set<string>(SIMPLY_HTML_SVG_ATTRS);

export const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "colspan", "rowspan", "scope",
  "start", "reversed", "type", "open", "dir", "lang",
  "width", "height", "loading", "id", "class",
  // inert form-control attributes (NO `name`/`form`/`formaction` — avoids DOM clobbering and any
  // form-submission/navigation target). The runtime drives value/checked at runtime via data-sh-bind.
  "value", "placeholder", "checked", "disabled", "readonly", "min", "max", "step", "maxlength",
  "rows", "cols", "for",
  ...SIMPLY_HTML_SVG_ATTRS,
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
    SANITIZE_DOM: true, // EXPLICIT: strip id/name that clobber document/form props (DOM clobbering)
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
    const d = data as { attrName?: string; attrValue?: string; keepAttr?: boolean; forceKeepAttr?: boolean };
    if (!d || !d.attrName) return;
    if (d.attrName === "src" && node.tagName === "IMG") {
      const v = (d.attrValue || "").trim();
      const ok = DATA_IMAGE_REGEX.test(v) || ALLOWED_URI_REGEXP.test(v);
      if (!ok) d.keepAttr = false;
    }
    // A static SVG presentation attribute (fill/stroke/clip-path/…) must not carry an external
    // url(<iri>): that funciri fires an off-page request — an exfil/beacon channel with no script.
    // Local gradient/clip refs url(#id) stay allowed. (Reactive data-sh-attr-* paints are checked
    // the same way at bind time in the runtime.)
    if (SH_SVG_ATTR_SET.has(d.attrName) && !isSafeSvgValue(d.attrValue || "")) {
      d.keepAttr = false;
      return;
    }
    // `data-sh-attr-<name>` is a reactive-attribute binding. ALLOW_DATA_ATTR is off, so DOMPurify
    // would drop it on the name check; force-keep ONLY the safe targets, drop the rest (e.g.
    // data-sh-attr-onclick) so an unsafe binding never even reaches the runtime.
    if (d.attrName.startsWith("data-sh-attr-")) {
      const target = d.attrName.slice("data-sh-attr-".length).toLowerCase();
      if (SIMPLY_HTML_ATTR_BIND_TARGETS.has(target)) d.forceKeepAttr = true;
      else d.keepAttr = false;
      return;
    }
    // `data-sh-arg-<param>` passes a read-only formula into a component — inert data, force-keep.
    if (d.attrName.startsWith("data-sh-arg-")) { d.forceKeepAttr = true; return; }
    // The closed data-sh-* hook set carries formulas / action calls / JSON whose values legitimately
    // contain ':' '(' etc. DOMPurify validates every attribute value against the URI allowlist and
    // would drop e.g. data-sh-on="click: toggle(..)" as a bogus URI. These are inert data the
    // BROWSER never interprets — only the sandboxed runtime does — so force-keep the whole closed set.
    if (SH_DIRECTIVE_SET.has(d.attrName)) d.forceKeepAttr = true;
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    // Strip any residual event handler attributes.
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
    // Coerce an unsafe <input type> (image/file/unknown) to text — no image-button form submit,
    // no file picker. Belt over the allowlist; the runtime only reads checkbox/number/text anyway.
    if (node.tagName === "INPUT" && node.hasAttribute("type")) {
      const t = (node.getAttribute("type") || "").toLowerCase();
      if (!SIMPLY_HTML_SAFE_INPUT_TYPES.has(t)) node.setAttribute("type", "text");
    }
    // Intersect class list against the allowlist.
    if (node.hasAttribute("class")) {
      const kept = (node.getAttribute("class") || "")
        .split(/\s+/)
        .filter((c) => c && SIMPLY_HTML_CLASS_ALLOWLIST.has(c));
      if (kept.length) node.setAttribute("class", kept.join(" "));
      else node.removeAttribute("class");
    }
    // Gate the reactive class too: `data-sh-class="<name> <formula>"` toggles <name> at runtime, so
    // <name> must pass the SAME class allowlist as a static class — otherwise the reactive path is a
    // CSS-exfiltration/spoof hole the static intersection above can't see.
    if (node.hasAttribute("data-sh-class")) {
      const className = (node.getAttribute("data-sh-class") || "").trim().split(/\s+/)[0] || "";
      if (!SIMPLY_HTML_CLASS_ALLOWLIST.has(className)) node.removeAttribute("data-sh-class");
    }
  });
}
