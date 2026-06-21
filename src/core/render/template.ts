// The Notion-quality reading template. This is the ONE trusted module that emits a
// <style> block; the model's <style> is always stripped by the sanitizer. Brand tokens
// are schema-validated (never passed verbatim into CSS) to close the CSS-injection vector
// under the deployed page's single `style-src 'unsafe-inline'` allowance.

import type { BrandTokens, TocEntry } from "../types.js";

export interface PageOptions {
  title: string;
  bodyHtml: string;
  toc: TocEntry[];
  brand?: BrandTokens;
  /** Extra markup for <head> (e.g. the boot script). */
  headExtra?: string;
  /** Extra markup before </body> (e.g. the runtime <script>). */
  bodyEndExtra?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const KEYWORD = /^[a-z]{3,20}$/i;
const FONT = /^[a-z0-9 ,'"-]{1,120}$/i;
const RASTER_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;
const HTTP_URL = /^https?:\/\/[^\s"']{1,500}$/i;

/** Validate brand tokens; drop anything that fails its schema. */
function safeBrand(brand?: BrandTokens): Required<Pick<BrandTokens, "density">> & {
  accent?: string;
  font?: string;
  name?: string;
  logo?: string;
} {
  const out: { accent?: string; font?: string; name?: string; logo?: string; density: "comfortable" | "compact" } = {
    density: brand?.density === "compact" ? "compact" : "comfortable",
  };
  if (brand?.accent && (HEX.test(brand.accent) || KEYWORD.test(brand.accent))) out.accent = brand.accent;
  if (brand?.font && FONT.test(brand.font)) out.font = brand.font;
  if (brand?.name) out.name = brand.name.slice(0, 120);
  if (brand?.logo && (RASTER_DATA.test(brand.logo) || HTTP_URL.test(brand.logo))) out.logo = brand.logo;
  return out;
}

function brandCss(b: ReturnType<typeof safeBrand>): string {
  const lines: string[] = [];
  if (b.accent) lines.push(`--k-accent:${b.accent};`);
  if (b.font) lines.push(`--k-font-body:${b.font},var(--k-font-fallback);`);
  if (b.density === "compact") lines.push(`--k-measure:58ch;--k-leading:1.45;`);
  return lines.length ? `:root{${lines.join("")}}` : "";
}

const BASE_CSS = `
:root{
  --k-font-body:"Inter","Inter var";
  --k-font-fallback:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --k-font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --k-measure:66ch; --k-leading:1.6;
  --k-accent:#e0603a;
  --k-bg:#fbfaf9; --k-surface:#ffffff; --k-ink:#1f1d1b; --k-ink-soft:#56514c;
  --k-line:#ece8e3; --k-code-bg:#f4f1ed; --k-mark:#fbe7c6;
}
@media (prefers-color-scheme:dark){
  :root{
    --k-bg:#0f0e0d; --k-surface:#1a1816; --k-ink:#ece8e3; --k-ink-soft:#a8a29b;
    --k-line:#2b2926; --k-code-bg:#1f1d1b; --k-mark:#5c4a2a;
  }
}
*{box-sizing:border-box}
html{ -webkit-text-size-adjust:100%; }
body{
  margin:0; background:var(--k-bg); color:var(--k-ink);
  font-family:var(--k-font-body),var(--k-font-fallback);
  font-size:18px; line-height:var(--k-leading);
  font-feature-settings:"kern","liga","calt"; text-rendering:optimizeLegibility;
}
.k-shell{ display:grid; grid-template-columns:1fr minmax(0,var(--k-measure)) 1fr; gap:0; }
.k-main{ grid-column:2; padding:72px 28px 160px; }
.k-toc{ grid-column:3; position:sticky; top:0; align-self:start; max-height:100vh;
  overflow:auto; padding:80px 24px; font-size:13.5px; line-height:1.5; }
.k-toc a{ display:block; color:var(--k-ink-soft); text-decoration:none; padding:3px 0; border-left:2px solid transparent; padding-left:12px; }
.k-toc a:hover{ color:var(--k-ink); }
.k-toc a.lvl-3{ padding-left:26px; font-size:12.5px; }
.k-header{ margin-bottom:40px; }
.k-brand{ display:flex; align-items:center; gap:10px; color:var(--k-ink-soft); font-size:13px; letter-spacing:.04em; text-transform:uppercase; margin-bottom:18px; }
.k-brand img{ height:20px; width:auto; border-radius:4px; }
.k-main h1{ font-size:2.15rem; line-height:1.15; letter-spacing:-0.02em; margin:0 0 .2em; }
.k-main h2{ font-size:1.45rem; line-height:1.25; letter-spacing:-0.01em; margin:2.2em 0 .6em; padding-bottom:.2em; border-bottom:1px solid var(--k-line); }
.k-main h3{ font-size:1.18rem; margin:1.8em 0 .5em; }
.k-main h4{ font-size:1.02rem; margin:1.5em 0 .4em; color:var(--k-ink-soft); }
.k-main p,.k-main li{ }
.k-main a{ color:var(--k-accent); text-decoration:none; border-bottom:1px solid color-mix(in srgb,var(--k-accent) 35%,transparent); }
.k-main a:hover{ border-bottom-color:var(--k-accent); }
.k-main strong{ font-weight:650; }
.k-main blockquote{ margin:1.4em 0; padding:.2em 1.1em; border-left:3px solid var(--k-accent); color:var(--k-ink-soft); }
.k-main code{ font-family:var(--k-font-mono); font-size:.86em; background:var(--k-code-bg); padding:.15em .4em; border-radius:5px; }
.k-main pre{ background:var(--k-code-bg); padding:18px 20px; border-radius:12px; overflow:auto; border:1px solid var(--k-line); }
.k-main pre code{ background:none; padding:0; font-size:.85em; line-height:1.55; }
.k-main mark{ background:var(--k-mark); padding:.05em .25em; border-radius:3px; }
.k-main hr{ border:none; border-top:1px solid var(--k-line); margin:2.6em 0; }
.k-main table{ border-collapse:collapse; width:100%; margin:1.4em 0; font-size:.94em; }
.k-main th,.k-main td{ border:1px solid var(--k-line); padding:8px 12px; text-align:left; }
.k-main th{ background:var(--k-code-bg); font-weight:600; }
.k-main img{ max-width:100%; height:auto; border-radius:8px; }
.k-main ul,.k-main ol{ padding-left:1.4em; }
.k-main li{ margin:.3em 0; }
.k-main .contains-task-list{ list-style:none; padding-left:.2em; }
.k-main .task-list-item{ display:flex; align-items:baseline; gap:.55em; }
.k-callout,.sh-callout{ margin:1.4em 0; padding:14px 18px; border-radius:12px; border:1px solid var(--k-line); background:var(--k-surface); }
.sh-callout.warn{ border-color:#caa14a; }
.sh-callout.danger{ border-color:#c0573e; }
.sh-callout.success{ border-color:#5a9367; }
.k-footer{ grid-column:2; padding:0 28px 80px; color:var(--k-ink-soft); font-size:13px; }
@media (max-width:1080px){
  .k-shell{ grid-template-columns:1fr; }
  .k-main,.k-footer{ grid-column:1; max-width:var(--k-measure); margin:0 auto; width:100%; }
  .k-toc{ display:none; }
}
/* interactive components (hydrated by the runtime; styles live here so the runtime ships no CSS) */
.k-comp-label{font-weight:600;font-size:.92em;margin-bottom:.4em;color:var(--k-ink-soft)}
.sh-todo,.sh-list,.sh-chat-pod{margin:1.2em 0;padding:14px 16px;border:1px solid var(--k-line);border-radius:12px;background:var(--k-surface)}
.k-x{margin-left:auto;border:none;background:none;color:var(--k-ink-soft);cursor:pointer;font-size:1.1em;line-height:1;opacity:.5}
.k-x:hover{opacity:1;color:var(--k-accent)}
.k-add{display:flex;margin-top:.6em}
.k-add input{flex:1;border:1px solid var(--k-line);background:var(--k-bg);color:var(--k-ink);border-radius:8px;padding:7px 10px;font:inherit;font-size:.95em}
.k-counter{display:inline-flex;align-items:center;gap:14px;border:1px solid var(--k-line);border-radius:12px;padding:8px 14px;background:var(--k-surface)}
.k-counter button{width:30px;height:30px;border:1px solid var(--k-line);border-radius:8px;background:var(--k-bg);color:var(--k-ink);font-size:1.1em;cursor:pointer}
.k-counter-val{min-width:2ch;text-align:center;font-variant-numeric:tabular-nums;font-weight:600}
.k-tabbar{display:flex;gap:6px;margin-bottom:1em;border-bottom:1px solid var(--k-line)}
.k-tab{border:none;background:none;color:var(--k-ink-soft);padding:6px 10px;cursor:pointer;border-bottom:2px solid transparent;font:inherit}
.k-tab.active{color:var(--k-ink);border-bottom-color:var(--k-accent)}
.k-chat-log{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto;margin:.4em 0}
.k-bubble{padding:9px 12px;border-radius:12px;max-width:85%;font-size:.95em;line-height:1.5;white-space:pre-wrap}
.k-bubble.user{align-self:flex-end;background:var(--k-accent);color:#fff;border-bottom-right-radius:4px}
.k-bubble.assistant{align-self:flex-start;background:var(--k-code-bg);color:var(--k-ink);border-bottom-left-radius:4px}
.k-bubble.pending{opacity:.6;font-style:italic}
.k-bubble.error{background:none;border:1px solid #c0573e;color:#c0573e;font-style:normal}
.k-chat-form{display:flex;gap:8px;margin-top:.5em}
.k-chat-form input{flex:1;border:1px solid var(--k-line);background:var(--k-bg);color:var(--k-ink);border-radius:8px;padding:8px 11px;font:inherit;font-size:.95em}
.k-chat-send{border:1px solid var(--k-accent);background:var(--k-accent);color:#fff;border-radius:8px;padding:0 16px;cursor:pointer;font:inherit}
.k-chat-send:disabled{opacity:.5;cursor:default}
/* select-to-edit overlay */
.k-edit-pill{position:fixed;z-index:9999;display:none;border:1px solid var(--k-line);background:var(--k-surface);color:var(--k-ink);font:inherit;font-size:.8em;padding:5px 10px;border-radius:8px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.12)}
.k-edit-pill:hover{border-color:var(--k-accent);color:var(--k-accent)}
.k-edit-target{outline:2px solid var(--k-accent);outline-offset:3px;border-radius:4px}
.k-edit-pod{position:fixed;z-index:9999;width:360px;background:var(--k-surface);border:1px solid var(--k-line);border-radius:12px;padding:12px;box-shadow:0 10px 32px rgba(0,0,0,.18)}
.k-edit-pod textarea{width:100%;box-sizing:border-box;border:1px solid var(--k-line);background:var(--k-bg);color:var(--k-ink);border-radius:8px;padding:8px 10px;font:inherit;font-size:.92em;resize:vertical}
.k-edit-actions{display:flex;align-items:center;gap:8px;margin-top:8px}
.k-edit-status{flex:1;font-size:.8em;color:var(--k-ink-soft)}
.k-edit-status.busy{color:var(--k-accent)}
.k-edit-status.error{color:#c0573e}
.k-edit-btn{border:1px solid var(--k-accent);background:var(--k-accent);color:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font:inherit;font-size:.88em}
.k-edit-btn.ghost{background:none;color:var(--k-ink-soft);border-color:var(--k-line)}
.k-edit-btn:disabled{opacity:.5;cursor:default}
`;

export function renderPage(opts: PageOptions): string {
  const b = safeBrand(opts.brand);
  const tocHtml = opts.toc.length
    ? `<nav class="k-toc" aria-label="On this page">${opts.toc
        .map((t) => `<a class="lvl-${t.level}" href="#${esc(t.id)}">${esc(t.text)}</a>`)
        .join("")}</nav>`
    : "";
  const brandBar = b.name || b.logo
    ? `<div class="k-brand">${b.logo ? `<img src="${esc(b.logo)}" alt="">` : ""}${b.name ? `<span>${esc(b.name)}</span>` : ""}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(opts.title)}</title>
<style>${BASE_CSS}${brandCss(b)}</style>
${opts.headExtra || ""}
</head>
<body>
<div class="k-shell">
<main class="k-main">
<header class="k-header">${brandBar}</header>
${opts.bodyHtml}
</main>
${tocHtml}
<footer class="k-footer">Published with simply-html</footer>
</div>
${opts.bodyEndExtra || ""}
</body>
</html>`;
}
