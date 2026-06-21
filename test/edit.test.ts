import { describe, it, expect } from "vitest";
import { render } from "../src/core/render/markdown.js";
import { applyRegionEdit } from "../src/core/edit.js";

function seed(md: string) {
  return render({ kind: "markdown", source: md }, "x"); // { html, toc, blockIds, title }
}

describe("applyRegionEdit", () => {
  it("replaces a block run and leaves the rest untouched", () => {
    const r = seed("# T\n\npara one\n\npara two");
    const res = applyRegionEdit(r.html, r.blockIds[1]!, r.blockIds[1]!, "<p>replaced</p>");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body).toContain("replaced");
    expect(res.body).not.toContain("para one");
    expect(res.body).toContain("para two");
    expect(res.replacement).toMatch(/data-sh-id="k_/); // new block gets a fresh id
  });

  it("strips model-forged data-sh-id and restamps (security)", () => {
    const r = seed("# T\n\npara");
    const forged = '<p data-sh-id="k_evil" data-sh-block="1">x</p>';
    const res = applyRegionEdit(r.html, r.blockIds[1]!, r.blockIds[1]!, forged);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body).not.toContain("k_evil");
    expect(res.replacement).not.toContain("k_evil");
    expect(res.replacement).toMatch(/data-sh-id="k_/);
  });

  it("rejects an unknown region", () => {
    const r = seed("# T\n\npara");
    expect(applyRegionEdit(r.html, "k_nope", "k_nope", "<p>x</p>").ok).toBe(false);
  });

  it("sanitizes the replacement — no script survives", () => {
    const r = seed("# T\n\npara");
    const res = applyRegionEdit(r.html, r.blockIds[1]!, r.blockIds[1]!, "<p>ok</p><script>alert(1)</script>");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body).not.toContain("<script");
    expect(res.body).not.toContain("alert(1)");
    expect(res.body).toContain("ok");
  });

  it("recomputes the TOC when a heading is edited in", () => {
    const r = seed("# T\n\npara");
    const res = applyRegionEdit(r.html, r.blockIds[1]!, r.blockIds[1]!, '<h2 id="new">New Section</h2>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.toc.some((t) => t.text === "New Section")).toBe(true);
  });
});
