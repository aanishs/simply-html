// The sanitizer is the entire safety story for hosting model-edited content behind a
// shared PIN. These tests lock the invariant: dangerous markup out, content + the closed
// data-sh-* hook set in.
import { describe, it, expect } from "vitest";
import { getNodeSanitizer } from "../src/core/sanitize/node.js";

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
