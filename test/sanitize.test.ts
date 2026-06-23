// The sanitizer is the entire safety story for hosting model-edited content behind a
// shared PIN. These tests lock the invariant: dangerous markup out, content + the closed
// data-sh-* hook set in.
import { describe, it, expect } from "vitest";
import { getNodeSanitizer, parseFragment } from "../src/core/sanitize/node.js";

const s = getNodeSanitizer();
const clean = (h: string) => s.sanitizeHtml(h);

describe("sanitizer: dangerous markup is stripped", () => {
  it("removes <script> but keeps surrounding text", () => {
    const out = clean("hello <script>alert(1)</script> world");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });

  it("strips event-handler attributes (onerror/onclick) but keeps the element", () => {
    const out = clean('<span onclick="alert(1)">x</span>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("x");
    const img = clean('<img src="x.png" onerror="alert(1)">');
    expect(img).not.toMatch(/onerror/i);
  });

  it("drops javascript: URLs on links", () => {
    const out = clean('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("click");
  });

  it("removes <iframe>, <style>, <object>", () => {
    expect(clean("<iframe src=evil></iframe>")).not.toContain("<iframe");
    expect(clean("<style>body{}</style>")).not.toContain("<style");
    expect(clean("<object data=x></object>")).not.toContain("<object");
  });

  it("blocks data:image/svg+xml but allows raster data: images", () => {
    const svg = clean('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">');
    expect(svg).not.toContain("data:image/svg");
    const png = clean('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(png).toContain("data:image/png");
  });

  it("strips arbitrary data-* but keeps the closed data-sh-* hooks", () => {
    const out = clean('<div data-sh-component="todo" data-sh-key="g" data-evil="1">x</div>');
    expect(out).toContain('data-sh-component="todo"');
    expect(out).toContain('data-sh-key="g"');
    expect(out).not.toMatch(/data-evil/);
  });

  it("intersects class tokens against the allowlist", () => {
    const out = clean('<div class="sh-callout warn exfil-selector">x</div>');
    expect(out).toContain("sh-callout");
    expect(out).toContain("warn");
    expect(out).not.toContain("exfil-selector");
  });
});

describe("sanitizer: substrate directives survive; dangerous bindings do not", () => {
  it("keeps the closed substrate directive set on hosted pages", () => {
    const out = clean(
      `<div data-sh-app data-sh-state='{"n":1}'>` +
      `<p data-sh-text="count(items where done)" data-sh-show="n > 0" data-sh-class="success n"></p>` +
      `<ul data-sh-repeat="items" data-sh-as="it"><li data-sh-on="click: toggle(it, 'done')"></li></ul>` +
      `</div>`,
    );
    expect(out).toContain("data-sh-app");
    expect(out).toContain("data-sh-state");
    expect(out).toContain("data-sh-text");
    expect(out).toContain("data-sh-show");
    expect(out).toContain("data-sh-class");
    expect(out).toContain("data-sh-repeat");
    expect(out).toContain("data-sh-as");
    expect(out).toContain("data-sh-on");
  });

  it("keeps component directives (data-sh-def / data-sh-use / data-sh-arg-*)", () => {
    const out = clean(
      `<div data-sh-def="row"><span data-sh-text="h.name"></span></div>` +
      `<div data-sh-use="row" data-sh-arg-h="item"></div>`,
    );
    expect(out).toContain("data-sh-def");
    expect(out).toContain("data-sh-use");
    expect(out).toContain("data-sh-arg-h");
  });

  it("keeps chart directives (data-sh-chart / values / labels / max)", () => {
    const out = clean(
      `<div data-sh-chart="bar" data-sh-values="[1,2,3]" data-sh-labels="names" data-sh-max="10"></div>`,
    );
    expect(out).toContain("data-sh-chart");
    expect(out).toContain("data-sh-values");
    expect(out).toContain("data-sh-labels");
    expect(out).toContain("data-sh-max");
  });

  it("allows a safe SVG drawing but strips its script vectors", () => {
    // safe shapes survive (the model can draw a chart)…
    const safe = clean(`<svg viewBox="0 0 10 10"><rect x="1" y="1" width="5" height="5" fill="red"></rect><path d="M0 0 L10 10"></path></svg>`);
    expect(safe).toMatch(/<svg/i);
    expect(safe).toMatch(/<rect/i);
    expect(safe).toContain("viewBox");
    expect(safe).toContain('d="M0 0 L10 10"');
    // …but every script vector is removed
    expect(clean(`<svg onload="alert(1)"><rect></rect></svg>`)).not.toMatch(/onload/i);
    expect(clean(`<svg><script>alert(1)</script></svg>`)).not.toMatch(/<script/i);
    expect(clean(`<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>`)).not.toMatch(/foreignobject/i);
    expect(clean(`<svg><animate attributeName="href" values="javascript:alert(1)"></animate></svg>`)).not.toMatch(/<animate/i);
    expect(clean(`<svg><use href="data:image/svg+xml,x"></use></svg>`)).not.toMatch(/<use/i);
    expect(clean(`<svg><a href="javascript:alert(1)"><rect></rect></a></svg>`)).not.toMatch(/javascript:/i);
  });

  it("drops a data-sh-class whose class is not in the class allowlist (no reactive CSS-exfil)", () => {
    const allowed = clean(`<span data-sh-class="success n > 0">x</span>`);
    expect(allowed).toContain("data-sh-class"); // allowlisted class survives
    const blocked = clean(`<span data-sh-class="attacker-controlled n > 0">x</span>`);
    expect(blocked).not.toContain("data-sh-class"); // arbitrary class -> directive dropped
    expect(blocked).not.toContain("attacker-controlled");
  });

  it("keeps a safe data-sh-attr-* target but drops event/style/unknown targets", () => {
    const out = clean(
      `<a data-sh-attr-href="'#x'" data-sh-attr-onclick="'alert(1)'" ` +
      `data-sh-attr-style="'color:red'" data-sh-attr-srcset="'x'">y</a>`,
    );
    expect(out).toContain("data-sh-attr-href"); // safe target survives
    expect(out).not.toMatch(/data-sh-attr-onclick/i); // event target dropped at sanitize time
    expect(out).not.toMatch(/data-sh-attr-style/i);
    expect(out).not.toMatch(/data-sh-attr-srcset/i); // unknown target dropped
  });

  it("strips DOM-clobbering id/name (SANITIZE_DOM is explicit, not implicit)", () => {
    expect(clean('<div id="attributes">x</div>')).not.toMatch(/id=/i); // clobbers Element.attributes
    expect(clean('<input id="body">')).not.toMatch(/id=/i); // clobbers document.body
    expect(clean('<a id="x">y</a>')).toContain('id="x"'); // a benign id still survives
  });

  it("a data-sh-on value is inert data, never promoted to an event handler", () => {
    // the runtime binds data-sh-on on any element; <button> is forbidden by the tag allowlist, so
    // a hosted substrate app uses an allowed element (e.g. a span with role=button) for actions.
    const out = clean(`<span role="button" data-sh-on="click: toggle(x, 'done')">go</span>`);
    expect(out).toContain("data-sh-on"); // kept as opaque data for the runtime
    expect(out).not.toMatch(/\sonclick/i); // but never becomes a real handler
    // re-parse and confirm the node carries no on* handler attribute
    const el = parseFragment(out).querySelector("span")!;
    expect(Array.from(el.attributes).some((a) => /^on/i.test(a.name))).toBe(false);
  });
});

describe("sanitizer: legitimate reading content survives", () => {
  it("keeps headings, lists, tables, code, links, images", () => {
    const html =
      '<h2 id="a">Title</h2><p>text <a href="https://x.com">link</a> <code>x</code></p>' +
      "<ul><li>one</li></ul><table><tr><td>c</td></tr></table>" +
      '<img src="https://x.com/i.png" alt="i">';
    const out = clean(html);
    expect(out).toContain("<h2");
    expect(out).toContain("https://x.com");
    expect(out).toContain("<code>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<td>c</td>");
    expect(out).toContain('src="https://x.com/i.png"');
  });
});

describe("sanitizeRegion: rejects content that is entirely unsafe", () => {
  it("rejects a region that is only a script", () => {
    const r = s.sanitizeRegion("<script>steal()</script>");
    expect(r.ok).toBe(false);
  });
  it("accepts a region with real content", () => {
    const r = s.sanitizeRegion("<p>fine</p>");
    expect(r.ok).toBe(true);
  });
});
