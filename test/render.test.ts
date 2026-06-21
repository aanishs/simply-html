import { describe, it, expect } from "vitest";
import { render } from "../src/core/render/markdown.js";
import { renderPage } from "../src/core/render/template.js";

describe("markdown render", () => {
  it("renders markdown, stamps stable block ids, extracts a title + TOC", () => {
    const md = "# Hello World\n\nSome text.\n\n## Section A\n\ntext\n\n## Section B\n\nmore";
    const r = render({ kind: "markdown", source: md }, "fallback");
    expect(r.title).toBe("Hello World");
    expect(r.blockIds.length).toBeGreaterThan(0);
    expect(r.blockIds.every((id) => id.startsWith("k_"))).toBe(true);
    expect(r.toc.map((t) => t.text)).toEqual(["Section A", "Section B"]);
    expect(r.html).toContain('data-sh-id="');
  });

  it("is deterministic: same markdown yields the same block ids", () => {
    const md = "# T\n\npara one\n\npara two";
    const a = render({ kind: "markdown", source: md }, "x");
    const b = render({ kind: "markdown", source: md }, "x");
    expect(a.blockIds).toEqual(b.blockIds);
  });

  it("escapes raw HTML embedded in markdown (html:false)", () => {
    const r = render({ kind: "markdown", source: "text <script>alert(1)</script>" }, "x");
    expect(r.html).not.toContain("<script");
  });

  it("sanitizes a raw-HTML page input", () => {
    const r = render({ kind: "html", source: "<h1>Hi</h1><script>alert(1)</script>" }, "x");
    expect(r.title).toBe("Hi");
    expect(r.html).not.toContain("<script");
  });
});

describe("reading template", () => {
  it("wraps body, includes the title, and validates brand tokens", () => {
    const page = renderPage({
      title: "My Doc",
      bodyHtml: "<p>hi</p>",
      toc: [{ level: 2, id: "a", text: "A" }],
      brand: { accent: "#123456", name: "Acme", font: "Georgia" },
    });
    expect(page).toContain("<title>My Doc</title>");
    expect(page).toContain('class="k-toc"');
    expect(page).toContain("--k-accent:#123456");
    expect(page).toContain("Acme");
  });

  it("drops an invalid (injection) accent token", () => {
    const page = renderPage({
      title: "x",
      bodyHtml: "<p>hi</p>",
      toc: [],
      brand: { accent: "red; } body { background: url(javascript:alert(1))" },
    });
    expect(page).not.toContain("javascript:");
    expect(page).not.toContain("url(");
  });
});
