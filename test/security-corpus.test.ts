// Adversarial security corpus — the "receipts" behind the no-model-JS safety claim.
//
// Real, sourced XSS / mXSS / DOMPurify-bypass vectors are run through the SHIPPED sanitizer
// (getNodeSanitizer — the exact instance the CLI + serverless function use), and we assert
// STRUCTURALLY, by re-parsing the output the way a browser would, that nothing executable
// survives: no <script>, no on* handler, no javascript:/vbscript:/data:text/html URL, no
// forbidden tag. mXSS is precisely about re-parse mutation, so re-parsing the sanitizer's
// OUTPUT (not just string-matching it) is the assertion that matters.
//
// This is a LIVING corpus, not a guarantee. DOMPurify has had bypasses (cure53 finds and
// patches them); the design is defense-in-depth — a closed tag/attr allowlist + jsdom +
// exact-pinned versions — verified against the known-attack literature, and extended when
// new vectors land. See SECURITY.md for the threat model.
//
// Sources cited per case:
//   OWASP  = OWASP XSS Filter Evasion Cheat Sheet
//   cure53 = cure53 DOMPurify bypass writeups / DOMPurify mXSS test suite
//   PS     = PortSwigger Web Security Academy XSS cheat sheet
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { getNodeSanitizer } from "../src/core/sanitize/node.js";
import { render } from "../src/core/render/markdown.js";

// Tags that must NEVER survive. <input>/<button>/<textarea>/<label> are deliberately NOT here:
// they are allowed for substrate apps but INERT (no <form>, every on* stripped, no form-action
// attr), so assertInert still proves the real property — no handler, no dangerous URL — on them.
const FORBIDDEN_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "FORM",
  "SELECT", "SVG", "MATH", "NOSCRIPT", "TEMPLATE", "TITLE",
  "FRAME", "FRAMESET", "APPLET",
]);
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "data", "background", "srcset", "poster"]);
const BAD_SCHEME = /(?:javascript|vbscript|livescript|mocha):|data:text\/html|data:application/i;

/** Re-parse the sanitized output as a browser would, then assert nothing executable survives. */
function assertInert(sanitized: string, label: string): void {
  const { document } = new JSDOM(`<!DOCTYPE html><body>${sanitized}</body>`).window;
  // No <script> even after re-serialization (mXSS frequently only re-materializes on parse).
  expect(/<script[\s/>]/i.test(document.body.innerHTML), `<script> survived [${label}]: ${sanitized}`).toBe(false);
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    expect(FORBIDDEN_TAGS.has(el.tagName), `forbidden <${el.tagName.toLowerCase()}> survived [${label}]: ${sanitized}`).toBe(false);
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      expect(name.startsWith("on"), `event handler ${name} survived [${label}]: ${sanitized}`).toBe(false);
      if (URL_ATTRS.has(name)) {
        // Collapse control chars + whitespace the way a URL parser does before scheme matching.
        const collapsed = attr.value.replace(/\s+/g, "");
        expect(BAD_SCHEME.test(attr.value) || BAD_SCHEME.test(collapsed), `dangerous URL ${name}="${attr.value}" survived [${label}]: ${sanitized}`).toBe(false);
      }
    }
  }
}

interface Vector { name: string; src: string; payload: string }

const CORPUS: Vector[] = [
  // --- direct script injection ---
  { name: "bare script", src: "OWASP", payload: `<script>alert(1)</script>` },
  { name: "split/nested script", src: "OWASP", payload: `<scr<script>ipt>alert(1)</scr</script>ipt>` },
  { name: "svg > script", src: "OWASP", payload: `<svg><script>alert(1)</script></svg>` },
  { name: "typed script", src: "OWASP", payload: `<script type="text/javascript">alert(1)</script>` },

  // --- event handlers ---
  { name: "img onerror", src: "OWASP", payload: `<img src=x onerror=alert(1)>` },
  { name: "svg onload", src: "PS", payload: `<svg onload=alert(1)>` },
  { name: "body onload", src: "OWASP", payload: `<body onload=alert(1)>` },
  { name: "input autofocus onfocus", src: "OWASP", payload: `<input autofocus onfocus=alert(1)>` },
  { name: "details ontoggle", src: "PS", payload: `<details open ontoggle=alert(1)>x</details>` },
  { name: "uppercase ONERROR", src: "OWASP", payload: `<IMG SRC=x ONERROR=alert(1)>` },
  { name: "onpointerover", src: "PS", payload: `<div onpointerover=alert(1)>x</div>` },

  // --- dangerous URL schemes ---
  { name: "anchor javascript:", src: "OWASP", payload: `<a href="javascript:alert(1)">x</a>` },
  { name: "anchor mixed-case js", src: "OWASP", payload: `<a href="jAvAsCrIpT:alert(1)">x</a>` },
  { name: "anchor entity-encoded js", src: "OWASP", payload: `<a href="java&#115;cript:alert(1)">x</a>` },
  { name: "anchor tab-broken js", src: "OWASP", payload: `<a href="java\tscript:alert(1)">x</a>` },
  { name: "anchor vbscript:", src: "OWASP", payload: `<a href="vbscript:msgbox(1)">x</a>` },
  { name: "img data:text/html", src: "OWASP", payload: `<img src="data:text/html,<script>alert(1)</script>">` },
  { name: "anchor data:text/html base64", src: "PS", payload: `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>` },

  // --- dangerous tags ---
  { name: "iframe", src: "OWASP", payload: `<iframe src="https://evil.example/"></iframe>` },
  { name: "iframe srcdoc", src: "PS", payload: `<iframe srcdoc="<script>alert(1)</script>"></iframe>` },
  { name: "object data", src: "OWASP", payload: `<object data="data:text/html,<script>alert(1)</script>"></object>` },
  { name: "embed", src: "OWASP", payload: `<embed src="data:text/html,<script>alert(1)</script>">` },
  { name: "base href hijack", src: "OWASP", payload: `<base href="https://evil.example/">` },
  { name: "meta refresh js", src: "OWASP", payload: `<meta http-equiv="refresh" content="0;url=javascript:alert(1)">` },
  { name: "link import", src: "OWASP", payload: `<link rel="import" href="javascript:alert(1)">` },
  { name: "form formaction", src: "PS", payload: `<form action="javascript:alert(1)"><button>x</button></form>` },

  // --- style / CSS ---
  { name: "style block js url", src: "OWASP", payload: `<style>*{background:url("javascript:alert(1)")}</style>` },
  { name: "inline style js url", src: "OWASP", payload: `<div style="background:url(javascript:alert(1))">x</div>` },

  // --- mutation XSS (cure53 / DOMPurify history) ---
  { name: "mXSS svg/style namespace confusion", src: "cure53", payload: `<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">` },
  { name: "mXSS math/mglyph/style", src: "cure53", payload: `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>` },
  { name: "mXSS noscript", src: "cure53", payload: `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>` },
  { name: "mXSS comment", src: "cure53", payload: `<!--><script>alert(1)</script>-->` },
  { name: "mXSS template", src: "cure53", payload: `<template><img src=x onerror=alert(1)></template>` },
  { name: "mXSS form/math nesting", src: "cure53", payload: `<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>` },
  { name: "mXSS svg foreignObject", src: "cure53", payload: `<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>` },

  // --- added after codex security review ---
  { name: "OWASP polyglot", src: "OWASP", payload: `javascript:/*--></title></style></textarea></script></xmp><svg/onload=alert(1)>` },
  { name: "svg+xml data image (raster-only hook must reject)", src: "cure53", payload: `<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">` },
  { name: "object codebase js", src: "PS", payload: `<object codebase="javascript:alert(1)" data="x"></object>` },

  // --- substrate interactive surface: tags are allowed but must stay inert ---
  { name: "input type=image js src", src: "PS", payload: `<input type="image" src="javascript:alert(1)" formaction="javascript:alert(1)">` },
  { name: "input type=file (coerced)", src: "OWASP", payload: `<input type="file">` },
  { name: "button formaction js", src: "PS", payload: `<button formaction="javascript:alert(1)">x</button>` },
  { name: "button formaction outside form", src: "PS", payload: `<button form="f" formaction="data:text/html,<script>alert(1)</script>">x</button>` },
];

const sanitizer = getNodeSanitizer();

// Entry point 1: a raw HTML file is hosted as-is but ALWAYS passes through sanitizeHtml first.
describe("security corpus / sanitizeHtml (raw-HTML-file path)", () => {
  for (const v of CORPUS) {
    it(`neutralizes ${v.name} [${v.src}]`, () => {
      assertInert(sanitizer.sanitizeHtml(v.payload), v.name);
    });
  }
});

// Entry point 2: select-to-edit replacement HTML (model output during an edit) -> sanitizeRegion.
// It either rejects outright (ok:false) or returns inert content; both are safe.
describe("security corpus / sanitizeRegion (select-to-edit path)", () => {
  for (const v of CORPUS) {
    it(`neutralizes ${v.name} [${v.src}]`, () => {
      const r = sanitizer.sanitizeRegion(v.payload);
      if (r.ok) assertInert(r.html, v.name);
    });
  }
});

// Entry point 3: the markdown pipeline runs html:false, so raw HTML inside a .md is ESCAPED
// to text, never parsed as elements.
describe("security corpus / markdown html:false (raw HTML is escaped, not executed)", () => {
  for (const v of CORPUS.slice(0, 12)) {
    it(`escapes ${v.name} in markdown [${v.src}]`, () => {
      assertInert(render({ kind: "markdown", source: v.payload }, "x").html, v.name);
    });
  }
});

// data-sh-* values are allowed through the sanitizer, but a value that LOOKS like HTML must
// stay an attribute value (escaped on serialize), never break out into a live element.
describe("security corpus / data-sh-* attribute values cannot break out into HTML", () => {
  const cases = [
    `<div data-sh-prompt="</div><img src=x onerror=alert(1)>">hi</div>`,
    `<p data-sh-label='&quot;><img src=x onerror=alert(1)>'>hi</p>`,
    `<span data-sh-key="x&quot; onmouseover=&quot;alert(1)">hi</span>`,
  ];
  for (const [i, payload] of cases.entries()) {
    it(`keeps hostile data-sh-* value inert (#${i + 1})`, () => {
      assertInert(sanitizer.sanitizeHtml(payload), `data-sh #${i + 1}`);
    });
  }
});

// Negative control: a legitimate raster data: image SURVIVES (the allowlist is not merely
// blocking everything) and is still inert. Proves the sanitizer discriminates, not just denies.
describe("security corpus / negative control — raster data: image is allowed + inert", () => {
  it("keeps a valid png data URI", () => {
    const png = `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC">`;
    const out = sanitizer.sanitizeHtml(png);
    expect(/<img[^>]+src="data:image\/png;base64,/i.test(out), `png data image should survive: ${out}`).toBe(true);
    assertInert(out, "png control");
  });
});
