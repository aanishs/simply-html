# simply-html

[![CI](https://github.com/aanishs/simply-html/actions/workflows/ci.yml/badge.svg)](https://github.com/aanishs/simply-html/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Turn the markdown/HTML your AI agent writes into a living page you can read, edit by talking to
it, and safely share — where the model writes content, never JavaScript.**

If you use Claude Code or Codex and you're tired of agent output arriving as a 1,000-line Markdown
wall you'll never actually read, this is for you. simply-html renders that output as a real page,
lets you **edit it by selecting text and saying what to change**, persists it behind a shared link,
and can even turn it into a **tiny reactive app** — all without the model writing a line of JS.

![select-to-edit: highlight a paragraph, say what to change, and your local CLI rewrites it in place — sanitized, no model JavaScript](assets/select-to-edit.gif)

**Live demo:** [a "Launch Week" page behind a PIN](https://sh-launch-week-69b6.vercel.app) — PIN
`8156`. It's read-only by design (the live editing + chat run in the local `preview`, where they're
free to use your own CLI). Run the quickstart below to get the full thing.

> Status: **v0, experimental** — a fun project built to see how far one idea goes (more on that
> below). Expect rough edges; issues and ideas welcome.

## The one rule (and it's a security rule)

**The model writes content, never JavaScript — and never CSS.** That's the whole design, and the
reason a *model-edited* page is safe to put behind a shared link.

The problem it avoids: the moment a hosted, shared page can carry model-authored JavaScript, any
prompt-injected or hostile instruction can become a `<script>` that runs in a visitor's browser.
You can't review your way out of arbitrary JS. So simply-html doesn't let the model emit it:

- **The model only ever emits HTML + a closed set of declarative `data-sh-*` hooks.** Every byte of
  model-authored markup — including every select-to-edit rewrite — passes one pinned,
  closed-allowlist DOMPurify + jsdom pass before it reaches a page: no `<script>`, no `on*`
  handlers, no `javascript:` URLs, no `<form>`, no arbitrary attributes.
- **All interactivity lives in one audited runtime** that ships with simply-html — code *you* can
  read — so model-authored script can't survive onto the page in the first place.

This is **defense-in-depth** (closed allowlist + jsdom + exact-pinned versions + a live adversarial
test corpus), not a claim of universal safety — DOMPurify has had bypasses, and the honest threat
model is in [SECURITY.md](SECURITY.md). The safety guarantee protects a *visitor* from the page; the
PIN is only a deterrent for casual access, not an authorization system.

## Two things it does

**1. Make agent output readable, AI-editable, and shareable** — the proven core. Render a plan,
report, or doc; select any passage and say what to change (your local `claude`/`codex` CLI makes the
edit, using your own CLI — no extra service); persist small data; publish behind a PIN.

**2. Let an agent build a tiny reactive app** — the experimental edge. When the content wants
interactivity, the model can author a small app with HTML + read-only **formulas** + `data-sh-*`
directives — *still no JavaScript*:

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

A working habit tracker — derived counts, toggle, add, remove, reusable components — with **zero
authored JavaScript or CSS in the `data-sh-app` region**. (The page *shell* around it — the design
and the runtime — is the host's, not the model's; see
[`examples/habit-tracker.html`](examples/habit-tracker.html), which is commented to make the split
obvious.) How it stays safe even here:

- **Formulas are read-only by construction** — an AST interpreter with no assignment node and no
  `eval`, so a formula literally cannot mutate state or reach a prototype; built-in member names and
  JS globals are blocked, and work/size are capped.
- **The only way state changes is a closed action registry** (`toggle`/`set`/`inc`/`remove`/`add`).
- **Interactive tags (`<input>`/`<button>`) are allowed but inert** — no `<form>`, every `on*`
  stripped, no form-action attrs; only the runtime animates them.

The full grammar is the authoring contract in **[AUTHORING.md](AUTHORING.md)** (plus the
`simply-html-app` / `simply-html-design` skills). This reactive substrate is the newest, least-proven
part — fun to use, and reviewed (see Security), but treat it as the experimental edge, not the core.

## Why HTML over Markdown? (I'm borrowing this idea, not inventing it)

This project is downstream of a 2026 argument that landed hard in the Claude Code community:

- **Thariq Shihipar** (Anthropic, Claude Code team) — *"The Unreasonable Effectiveness of HTML"*
  ([post](https://thariqs.github.io/html-effectiveness/) ·
  [Simon Willison's writeup](https://simonwillison.net/2026/May/8/unreasonable-effectiveness-of-html/) ·
  [Lenny's "How I AI"](https://www.lennysnewsletter.com/p/how-i-ai-html-is-the-new-markdown)): a
  thousand-line Markdown plan goes unread; HTML turns it into something visual and interactive you'll
  actually engage with. He even had Claude build a disposable input/dropdown/add-remove UI to edit a
  plan's data — basically the seed of this project.
- **Theo (t3.gg)** — *"Stop letting your agents write Markdown"*
  ([discussion](https://finance.biggo.com/podcast/6f71ab363f4b2ede)): worth citing because he's
  honest that a chunk of HTML's current magic is novelty, and Markdown still wins when a doc is
  collaborative or pipeline-fed. simply-html answers his "collaborative" caveat by making the HTML
  editable and persistent, not a frozen artifact.

## Quickstart

```bash
git clone https://github.com/aanishs/simply-html && cd simply-html
npm install && npm run build
node dist/cli/index.js preview examples/test-page.html       # a reading page — select text to edit
node dist/cli/index.js preview examples/habit-tracker.html   # the reactive app (no model JS/CSS)
```

Or install the Claude Code skills in `skills/` and just say "preview this page" / "publish this page"
/ "turn this into a little app".

## Skills

- **`simply-html-preview`** — render a markdown or HTML file into a clean page locally; select text
  to edit it, chat with it, persist small data.
- **`simply-html-app`** — author a reactive mini-app (the grammar in [AUTHORING.md](AUTHORING.md)).
- **`simply-html-design`** — the locked design contract (you write meaning, not CSS).
- **`simply-html-publish`** — deploy a page to a real URL behind a PIN with one pasted token.

## Security

The sanitizer is the keystone, because "the model never writes JS" only means something if it's
*enforced*. The receipts are in [`test/security-corpus.test.ts`](test/security-corpus.test.ts): an
adversarial corpus of real, sourced vectors — **XSS filter-evasion, mutation-XSS, DOMPurify-bypass,
and substrate-injection** — drawn from OWASP, cure53, and PortSwigger, run through the *shipped*
sanitizer with structural re-parse assertions on every CI run (`npm test`). The substrate's own
guards (read-only formulas, closed actions, two-way binding) were also put through a multi-lens
adversarial sweep. The honest threat model — including what it *doesn't* cover — is in
[SECURITY.md](SECURITY.md).

## What it is not

- **Not a startup or a "platform."** An experiment, built to learn — eyes open.
- **Two use cases, different maturity.** Read + select-to-edit is the proven core; the reactive
  mini-app is the experimental edge. Don't mistake the second for the main pitch.
- **Not an app builder backend.** Data is a small primitive (todos, lists, counters, tiny apps), not
  an arbitrary backend.
- **Not for PHI or anything sensitive.** A public-CDN, PIN-gated host with no BAA and no HIPAA
  controls. The PIN is a deterrent, not auth.

## How it works (one diagram)

```
   agent writes markdown / HTML + read-only formulas   (content, never JS/CSS)
                          |
            +-------------v--------------+
            |  core: render + sanitize   |   markdown-it (html:false) +
            |  DOMPurify + jsdom         |   closed-allowlist DOMPurify
            +------+--------------+-------+
       local       |              |        deployed
   +---------------v---+    +-----v---------------------------+
   | bridge daemon     |    | one Vercel function             |
   | one process,      |    | PIN gate + small data store +   |
   | hosts many pages, |    | optional LLM proxy              |
   | preview + edit    |    +---------------------------------+
   +-------+-----------+
           |
   +-------v-----------+
   | runtime (browser) |   ONE audited IIFE, zero npm deps.
   | hydrates data-sh-*|   Components + reactive apps. NO model JS.
   +-------------------+
```

## License

MIT.
