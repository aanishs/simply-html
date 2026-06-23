# simply-html

[![CI](https://github.com/aanishs/simply-html/actions/workflows/ci.yml/badge.svg)](https://github.com/aanishs/simply-html/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A fun experiment: what if your agent's plan wasn't a 1,000-line Markdown file you'll never read — but a living HTML page you can actually *use*?**

You know the feeling. You ask Claude or Codex for a plan, a report, a design doc — and you get back a wall of Markdown so long that you stop reading it and just ask the model to edit it for you. At which point... you're not really in the loop anymore.

This is a small, hands-on project poking at that problem. The bet — which I'm borrowing, not inventing — is that **HTML is a better target than Markdown for things an agent makes.** Markdown tops out at a wall of text; HTML can be a scrollable, visual, *interactive* artifact you'll actually engage with. simply-html takes the HTML an agent already writes and turns it into a page you can read, talk to, edit by selecting text, and even **poke at like a tiny app** — all while staying safe to share behind a link.

It's experimental and built mostly to see how far the idea goes. Not a startup, not a framework you should bet your company on — a fun thing that turned out to be more interesting than expected.

![select-to-edit: highlight a paragraph, say what to change, and your local CLI rewrites it in place — sanitized, no model JavaScript](assets/select-to-edit.gif)

**Live demo:** [a "Launch Week" page, deployed behind a PIN](https://sh-launch-week-69b6.vercel.app) — PIN `8156`. (Read-only; select-to-edit and chat run in the local `preview`.)

> Status: early, experimental (v0). Expect rough edges.

## Why HTML instead of Markdown? (I'm not the first to say this)

This whole project is downstream of a 2026 argument that landed hard in the Claude Code community:

- **Thariq Shihipar** (Anthropic, Claude Code team) — *"The Unreasonable Effectiveness of HTML"* ([post](https://thariqs.github.io/html-effectiveness/) · [Simon Willison's writeup](https://simonwillison.net/2026/May/8/unreasonable-effectiveness-of-html/) · [Lenny's "How I AI"](https://www.lennysnewsletter.com/p/how-i-ai-html-is-the-new-markdown)). His point: a thousand-line Markdown plan goes unread — by you, by reviewers, by everyone. HTML turns the same plan into something visual and interactive you'll actually engage with. The kicker that basically *is* this project: he had Claude build a **disposable little UI — input fields, dropdowns, add/remove buttons — to edit the data in a plan visually**, then fold it back in. That's the seed simply-html grows from.
- **Theo (t3.gg)** — *"Stop letting your agents write Markdown"* ([discussion](https://finance.biggo.com/podcast/6f71ab363f4b2ede)). Worth citing because he's honest about the catch: a chunk of HTML's current magic is just *novelty*, and Markdown still wins when a doc is collaborative, indexed, or fed to a pipeline. simply-html is partly an answer to his "collaborative" caveat — make the HTML **editable and persistent**, not a frozen artifact.

So: this is me exploring what an agent-made *plan* can actually become once it's HTML — and how rich you can let it get **without giving up safety**.

## The one rule (and it's a security rule)

**The model writes content, never JavaScript. Ever.** This is not a style preference — it's the entire safety design, and it's the reason the project exists.

Here's the problem it solves. The moment you let a model emit JavaScript into a page you then *host and share*, you've created an unbounded injection surface: any prompt-injected or hostile instruction can become a `<script>` that runs in a visitor's browser — steal the PIN, exfiltrate data, rewrite the page. You cannot "review your way" out of that; arbitrary JS is arbitrary risk. Markdown-to-HTML tools that let the model write live `<script>`/JS can't be safely shared as *model-edited* pages for exactly this reason.

simply-html's answer is to make model-authored JS **structurally impossible**:

1. **Everything the model emits is sanitized** through one closed-allowlist DOMPurify + jsdom pass — no `<script>`, no `on*` handlers, no `javascript:` URLs, no `<form>`, no arbitrary attributes. (This runs on raw HTML *and* on every model edit.)
2. **All interactivity lives in one audited runtime** that ships with simply-html. The model only ever emits HTML + a closed set of declarative `data-sh-*` hooks; the runtime — code *I* wrote and you can read — does the rest.

That's the whole trick: there is no model-authored script to attack you with, just sanitized content driven by an audited engine.

## The fun part: pages that act like tiny apps

Beyond reading and editing, an agent can author a small **reactive app** — and *still* without writing a line of JavaScript. It writes HTML plus read-only **formulas** and a closed set of `data-sh-*` directives; the runtime makes it live.

```html
<div data-sh-app data-sh-state='{"draft":"","habits":[{"name":"Drink water","done":true}]}'>
  <p data-sh-text="count(habits where done) + ' of ' + count(habits) + ' done'"></p>

  <ul data-sh-repeat="habits" data-sh-as="h">
    <li>
      <button data-sh-on="click: toggle(h, 'done')" data-sh-text="h.name"></button>
      <button data-sh-on="click: remove(habits, h)">×</button>
    </li>
  </ul>

  <input data-sh-bind="draft" placeholder="Add a habit…">
  <button data-sh-on="click: add(habits, {name: draft, done: false}); set($, 'draft', '')">Add</button>
</div>
```

A working habit tracker — derived counts, toggle, add, remove, a "you're all done" state — with **zero** page-authored JS. Try it: [`examples/habit-tracker.html`](examples/habit-tracker.html). How it stays safe even here:

- **Formulas are read-only by construction.** They're parsed to an AST and interpreted (never `eval`); there is *no assignment node*, so a formula physically cannot mutate state or reach a prototype. `__proto__`/`constructor` are blocked, JS globals resolve to `undefined`, and there are work/size limits so a formula can't hang the page.
- **The only way state changes is a closed action registry** (`toggle/set/inc/remove/add`) — the audited mutations, not arbitrary code.
- **Interactive tags (`<input>`/`<button>`) are allowed but inert.** No `<form>`, every `on*` stripped, no form-action attributes — only the sandboxed runtime ever animates them.

The full grammar — directives, the formula language, actions, and reusable `data-sh-def`
components — is the authoring contract in **[AUTHORING.md](AUTHORING.md)** (and the
`simply-html-app` / `simply-html-design` skills). The reactive substrate is the newest, most
experimental piece — see [SECURITY.md](SECURITY.md) for the threat model.

## How it works

```
        an agent writes markdown / HTML + read-only formulas  (content, never JS)
                          |
            +-------------v--------------+
            |  core: render + sanitize   |   markdown-it (html:false)
            |  DOMPurify + jsdom,        | + closed-allowlist DOMPurify
            |  one shared config         |   -> block-id-stamped body
            +------+--------------+-------+
       local       |              |        deployed
   +---------------v---+    +-----v--------------------+
   | bridge daemon     |    | one Vercel function       |
   | one process,      |    | PIN gate (scrypt+cookie)  |
   | hosts many pages  |    | /data (Blob CAS) + /llm   |
   | preview + /llm +  |    +---------------------------+
   | select-to-edit    |
   +-------+-----------+
           |
   +-------v-----------+
   | runtime (browser) |   ONE audited IIFE, zero npm deps.
   | hydrates data-sh-*|   Components + reactive apps. NO model JS.
   +-------------------+
```

## Quickstart

```bash
git clone https://github.com/aanishs/simply-html && cd simply-html
npm install && npm run build
node dist/cli/index.js preview examples/test-page.html   # opens a local page; select text to edit it
```

Or install the two Claude Code skills in `skills/` and just say "preview this page" / "publish this page".

## The two skills

- **`/preview`** — render a markdown or HTML file into a clean, Notion-quality page, locally. The page is *alive*: select any passage and say what to change (your local `claude` / `codex` CLI makes the edit, free), chat with it, and persist small data.
- **`/publish`** — deploy that same page to a real URL with one pasted deploy token. The plumbing — a 4-digit PIN gate, a tiny data store, an optional LLM proxy, a personal hub — is deliberately boring. The point isn't the publish; it's that what you publish keeps thinking and editing itself, safely.

## Security

The sanitizer is the keystone, because (see above) "the model never writes JS" only means something if it's *enforced*. The receipts are in [`test/security-corpus.test.ts`](test/security-corpus.test.ts) — 100 real, sourced XSS / mutation-XSS / DOMPurify-bypass / substrate-injection vectors (OWASP, cure53, PortSwigger) run through the *shipped* sanitizer with structural assertions, on every CI run. The honest threat model — what it covers and, just as importantly, what it doesn't — is in [SECURITY.md](SECURITY.md).

## What it is not

- Not a startup or a "platform." It's an experiment I built for fun and to learn — eyes open.
- Not an app builder. Data is a small primitive (todos, lists, counters, tiny reactive apps), not an arbitrary backend.
- Not for PHI or anything sensitive. It's a public-CDN, PIN-gated host with no BAA and no HIPAA controls.

## License

MIT.
