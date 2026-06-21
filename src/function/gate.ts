// The PIN entry page. Pure HTML form (method=post to /api/k/pin) so it needs NO JavaScript
// and is safe under the strict deployed CSP. On success the function sets the cookie and
// redirects to the page; on failure it re-renders this with an error.

export interface GateOptions {
  digits: number;
  error?: boolean;
  brandName?: string;
  accent?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const ACCENT_OK = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function renderGate(opts: GateOptions): string {
  const accent = opts.accent && ACCENT_OK.test(opts.accent) ? opts.accent : "#e0603a";
  const name = opts.brandName ? esc(opts.brandName) : "";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Enter PIN</title>
<style>
:root{--bg:#fbfaf9;--surface:#fff;--ink:#1f1d1b;--soft:#56514c;--line:#ece8e3;--accent:${accent}}
@media (prefers-color-scheme:dark){:root{--bg:#0f0e0d;--surface:#1a1816;--ink:#ece8e3;--soft:#a8a29b;--line:#2b2926}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:34px 30px;width:min(360px,92vw);text-align:center}
.lock{font-size:26px;margin-bottom:6px}
h1{font-size:1.1rem;margin:0 0 4px}
p{color:var(--soft);font-size:.9rem;margin:0 0 20px}
.brand{color:var(--soft);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px}
input{width:100%;font-size:1.6rem;letter-spacing:.5em;text-align:center;padding:12px;border:1px solid var(--line);
border-radius:10px;background:var(--bg);color:var(--ink);font-variant-numeric:tabular-nums}
input:focus{outline:2px solid var(--accent);border-color:var(--accent)}
button{width:100%;margin-top:14px;padding:12px;border:none;border-radius:10px;background:var(--accent);color:#fff;
font-size:1rem;cursor:pointer}
.err{color:#c0573e;font-size:.85rem;margin-top:12px;min-height:1.1em}
</style></head>
<body>
<form class="card" method="post" action="/api/k/pin" autocomplete="off">
${name ? `<div class="brand">${name}</div>` : ""}
<div class="lock">&#128274;</div>
<h1>This page is private</h1>
<p>Enter the ${opts.digits}-digit PIN to continue.</p>
<input name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="${opts.digits}" autofocus aria-label="PIN">
<button type="submit">Unlock</button>
<div class="err">${opts.error ? "Wrong PIN. Try again." : ""}</div>
</form>
</body></html>`;
}
