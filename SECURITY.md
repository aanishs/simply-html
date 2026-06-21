# Security model

simply-html lets an AI model author a page that can be read, persisted, "thought with,"
and edited in place, and then hosted behind a shared PIN. The model is treated as
**untrusted input**. This document states exactly what that buys you, and what it does not.

## The one invariant

**The model writes content, never JavaScript.** It emits HTML, markdown, and a closed set
of declarative `data-sh-*` hooks. Every byte of model-authored HTML passes through one
sanitizer (DOMPurify on a jsdom document, pinned to exact versions) with a **closed tag and
attribute allowlist** before it is ever inserted into a page. All interactivity is
implemented by simply-html's own audited runtime, which the model cannot modify.

That is the entire reason a model-edited page is safe to put behind a shared link: there is
no model-authored script to smuggle an attack through, only sanitized content.

## Trust boundary

| Surface | Who authors it | Control |
|---|---|---|
| Markdown input | model / you | markdown-it `html:false` — raw HTML in a `.md` is **escaped to text**, never parsed as elements |
| Raw `.html` input | model / you | `getNodeSanitizer().sanitizeHtml()` before it reaches the page template |
| Select-to-edit replacement | model | `sanitizeRegion()`, then re-parse + splice; same sanitizer, same allowlist |
| `data-sh-*` attribute values | model | allowed through the sanitizer, then consumed by the runtime as **text / state / prompt strings**, never evaluated as HTML or JS |
| Page title, TOC text, brand name | you (config) | trusted config, HTML-escaped at template time (not model input) |
| Brand logo | you (config) | embedded as a raster `data:` image at template time; `data:image/svg+xml` is dropped |
| Persisted edit cache (`.simply-html/pages/*.json`) | the app | local state that was **already sanitized before it was written**; restored as trusted local cache |
| Deployed `/llm` chat answers | model | rendered as `textContent`, never as HTML — a separate, narrower boundary |

The sanitizer config lives in [`src/core/sanitize/config.ts`](src/core/sanitize/config.ts):
a closed `ALLOWED_TAGS`, an explicit `FORBID_TAGS` (script, style, iframe, object, embed,
form, svg, math, template, noscript, base, meta, link, ...), `ALLOW_DATA_ATTR: false`,
a URL allowlist that rejects `javascript:` / generic `data:`, raster-only `data:` images,
an `on*`-attribute strip hook, and a class allowlist.

## What the corpus proves (and what it doesn't)

[`test/security-corpus.test.ts`](test/security-corpus.test.ts) runs a corpus of real, sourced
XSS / mutation-XSS / DOMPurify-bypass vectors (OWASP XSS Filter Evasion cheat sheet, cure53
DOMPurify bypass history, PortSwigger) through the **shipped** sanitizer, across both
untrusted entry points, and asserts **structurally** — by re-parsing the sanitizer's output
the way a browser would — that nothing executable survives: no `<script>`, no `on*` handler,
no `javascript:`/`vbscript:`/`data:text/html` URL, no forbidden tag. A negative control
proves a legitimate raster `data:` image is still allowed (the allowlist discriminates, it
does not blanket-deny).

This is a **living regression corpus for known bypass classes**, not a proof of universal
safety. DOMPurify has had bypasses, and cure53 patches them as they are found; the design is
**defense in depth** (no-model-JS rule + closed allowlist + jsdom + exact-pinned versions),
verified against the known-attack literature and extended when new vectors land. Pinned
versions and CI (which runs the corpus on every push) are how a future dependency bump that
changed sanitizer behavior would be caught.

## Out of scope / residual risk (stated honestly)

- **Not PHI / HIPAA.** A deployed page is a public-CDN host gated by a short PIN. It is not a
  BAA-covered or HIPAA-controlled system. Do not put protected health information on it.
- **PIN, not auth.** The PIN deters casual access; it is not an identity system. Writable
  pages (`--db`/`--llm`) use a longer PIN and a durable lockout, but a determined attacker
  with the PIN has the access the PIN grants.
- **DOM clobbering.** `id`/`class` are allowed on model content, so id-based DOM clobbering is
  conceivable; it is not script execution, and the runtime reads its config from an object set
  by an inline boot script rather than by id lookup. Treated as low-risk residual, not yet a
  dedicated test.
- **Trusted surfaces are trusted.** Template fields and the serverless function code are
  authored by you, not the model; their safety rests on standard escaping and schema checks,
  not on this sanitizer.

## Reporting

This is a personal open-source project, not a funded program. If you find a sanitizer bypass
or another security issue, please open a GitHub issue (or, for something sensitive, a private
security advisory on the repo). A reproducing payload added to the corpus is the most useful
possible report.
