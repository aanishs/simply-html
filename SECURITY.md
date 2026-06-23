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
no model-authored script to smuggle an attack through, only sanitized content. This is a
**security** decision, not a stylistic one: the moment a hosted, shared page can carry
model-authored JavaScript, any prompt-injected or hostile instruction becomes arbitrary
script in a visitor's browser. You cannot review your way out of arbitrary JS, so the design
makes it structurally impossible to emit in the first place.

### Reactive apps without JavaScript

A page may also be a small **reactive app** (a `[data-sh-app]` region): the model writes HTML
plus read-only **formulas** and a closed set of `data-sh-*` directives, and simply-html's
runtime makes it live — still with zero model-authored JS. The safety properties that hold this
up:

- **Formulas are read-only by construction.** They are parsed to an AST and interpreted (never
  `eval`/`new Function`); there is **no assignment, statement, or loop node**, so a formula
  physically cannot mutate state or define behavior. Identifiers resolve only to own properties
  of a data scope (JS globals are simply not in scope → `undefined`); **every `Object.prototype`
  member name** (`__proto__`, `constructor`, `prototype`, `toString`, `valueOf`,
  `hasOwnProperty`, `__defineGetter__`, …) is blocked for both read and write; a fuel counter and
  collection-size caps bound work so a formula cannot hang the page.
- **State changes only through a closed action registry** (`toggle`/`set`/`inc`/`remove`/`add`) —
  audited mutations, never arbitrary code. Write targets are guarded by the same blocked-key set.
- **Interactive tags (`<input>`/`<button>`/`<textarea>`/`<label>`) are allowed but inert.** No
  `<form>` (so no submission/navigation), every `on*` handler stripped, no form-action attributes
  in the allowlist, and unsafe `<input type>` (`image`/`file`) coerced to `text`. Only the
  sandboxed runtime animates them, via `data-sh-on` / `data-sh-bind`.
- **Reactive URLs are re-checked exactly like the static door.** A `data-sh-attr-href`/`src`
  formula is opaque to the sanitizer, so the runtime re-validates the resolved value — and it
  **normalizes leading/embedded whitespace and control characters before the scheme check, the
  same way DOMPurify does**, so the reactive door can never admit a `" javascript:"` that the
  browser would strip back to a live scheme.
- **Reactive classes are gated by the same class allowlist** as static classes, so the
  CSS-exfiltration defense can't be bypassed through `data-sh-class`.

## Trust boundary

| Surface | Who authors it | Control |
|---|---|---|
| Markdown input | model / you | markdown-it `html:false` — raw HTML in a `.md` is **escaped to text**, never parsed as elements |
| Raw `.html` input | model / you | `getNodeSanitizer().sanitizeHtml()` before it reaches the page template |
| Select-to-edit replacement | model | `sanitizeRegion()`, then re-parse + splice; same sanitizer, same allowlist |
| `data-sh-*` attribute values | model | allowed through the sanitizer, then consumed by the runtime as **text / read-only formulas / closed action calls / JSON state**, never evaluated as HTML or JS |
| Substrate formulas / actions | model | parsed to a read-only AST + interpreted; closed function & action registries; all `Object.prototype` member names blocked for read and write |
| Reactive `data-sh-attr-href`/`src` | model | runtime re-validates the resolved URL against the allowlist **after** normalizing whitespace/control chars, mirroring the sanitizer |
| Interactive tags (`<input>`/`<button>`/…) | model | allowed but **inert** — no `<form>`, `on*` stripped, no form-action attrs, unsafe `<input type>` coerced to `text` |
| Page title, TOC text, brand name | you (config) | trusted config, HTML-escaped at template time (not model input) |
| Brand logo | you (config) | embedded as a raster `data:` image at template time; `data:image/svg+xml` is dropped |
| Persisted edit cache (`.simply-html/pages/*.json`) | the app | local state that was **already sanitized before it was written**; restored as trusted local cache |
| Deployed `/llm` chat answers | model | rendered as `textContent`, never as HTML — a separate, narrower boundary |

The sanitizer config lives in [`src/core/sanitize/config.ts`](src/core/sanitize/config.ts):
a closed `ALLOWED_TAGS`, an explicit `FORBID_TAGS` (script, style, iframe, object, embed,
**form**, **select**, svg, math, template, noscript, base, meta, link, ...), `ALLOW_DATA_ATTR:
false`, explicit `SANITIZE_DOM: true` (strips DOM-clobbering `id`/`name`), a URL allowlist that
rejects `javascript:` / generic `data:`, raster-only `data:` images, an `on*`-attribute strip
hook, an `<input type>` coercion hook, and a class allowlist that gates both static `class` and
reactive `data-sh-class`. The interactive tags `<button>`/`<input>`/`<textarea>`/`<label>` are
allowed but inert (see above); `<form>`/`<select>` remain forbidden.

## What the corpus proves (and what it doesn't)

[`test/security-corpus.test.ts`](test/security-corpus.test.ts) runs a corpus of 100 real, sourced
XSS / mutation-XSS / DOMPurify-bypass / substrate-injection vectors (OWASP XSS Filter Evasion
cheat sheet, cure53 DOMPurify bypass history, PortSwigger) through the **shipped** sanitizer,
across both untrusted entry points, and asserts **structurally** — by re-parsing the sanitizer's
output the way a browser would — that nothing executable survives: no `<script>`, no `on*`
handler, no `javascript:`/`vbscript:`/`data:text/html` URL, no forbidden tag. A negative control
proves a legitimate raster `data:` image is still allowed (the allowlist discriminates, it
does not blanket-deny). The substrate's own guards (read-only formula sandbox, closed actions,
two-way binding) carry their own suites in
[`test/formula.test.ts`](test/formula.test.ts) and [`test/substrate.test.ts`](test/substrate.test.ts).

### Adversarial review

The substrate expansion (allowing inert interactive tags, array/object formula literals, two-way
binding) was put through a five-lens adversarial security sweep — independent passes attacking the
sanitizer tags, the formula grammar, the binding/action layer, the sanitizer↔runtime promotion
gap, and a completeness critic, each producing concrete payloads run through the shipped code. **No
sandbox escape, prototype pollution, exfiltration, DOM clobbering, or mutation-XSS was found.** It
did surface one real bug — a reactive-URL re-check that didn't normalize whitespace before the
scheme test (a `" javascript:"` bypass) — plus several robustness/defense-in-depth gaps. All are
fixed and pinned by the regression tests in the suites above (`substrate / sweep regressions`).

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
- **DOM clobbering.** Handled explicitly: `SANITIZE_DOM: true` strips `id`/`name` values that
  collide with document/element properties, the runtime navigates by attribute selectors and live
  element references (never `getElementById`/`document[name]`), and reactive `id` is not a bindable
  target. Pinned by a test. Residual risk is low.
- **Local preview has no CSP.** The deployed Vercel page ships a strict CSP (`script-src 'self'`)
  as defense-in-depth, but the **local** `preview` bridge serves pages with no CSP header. The
  no-model-JS rule + sanitizer + runtime re-checks are what keep that path safe on their own — which
  is exactly why the reactive-URL normalization bug above mattered and was fixed. Treat the bridge
  as a local dev surface, not a hardened host.
- **App styling on hosted pages.** Substrate apps can only toggle classes that are in the closed
  class allowlist (the same constraint as static classes), so rich app-specific styling on a
  *hosted* page is limited today. Standalone/local pages are unaffected. A proper styling story for
  hosted apps is future, deliberate work.
- **State-corruption robustness.** A hostile co-editor who can author markup can still author
  *bad* state (e.g. an action that throws); the runtime fails safe (per-region isolation,
  `bump()` in `finally` so the DOM re-syncs, write-key guards) rather than executing anything, but
  authoring access is authoring access — the PIN is a deterrent, not an authorization system.
- **Trusted surfaces are trusted.** Template fields and the serverless function code are
  authored by you, not the model; their safety rests on standard escaping and schema checks,
  not on this sanitizer.

## Reporting

This is a personal open-source project, not a funded program. If you find a sanitizer bypass
or another security issue, please open a GitHub issue (or, for something sensitive, a private
security advisory on the repo). A reproducing payload added to the corpus is the most useful
possible report.
