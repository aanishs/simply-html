# simply-html

[![CI](https://github.com/aanishs/simply-html/actions/workflows/ci.yml/badge.svg)](https://github.com/aanishs/simply-html/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Publish a page your AI agent can safely keep editing.** simply-html turns the markdown/HTML an agent already makes into a live page you can read, talk to, and edit by selecting text. It stays safe to host behind a shared link, because the model writes *content*, never JavaScript.

<!-- TODO(demo): drop the select-to-edit GIF here once recorded -->

> Status: early build (v0).

## The one rule (the whole point)

**The model writes content, never JavaScript.** Every interactive part — select-to-edit, the chat pod, todo binding, the LLM and data calls — lives in one audited runtime that ships with simply-html. The model only ever emits HTML, markdown, and a fixed set of declarative `data-sh-*` hooks.

That is what makes a *model-edited* page safe to host behind a shared link: there is no model-authored script to smuggle an attack through, just sanitized content. It is the one thing the agent-HTML tools around it structurally can't do — Anthropic Artifacts sandboxes the network off, so its pages can't think or persist; Codex Sites and the live-JS hosts run model-written JavaScript, so a shared, model-edited page isn't safe. simply-html sits in exactly that gap.

## See it

Select any paragraph on a rendered page, tell it what to change, and your logged-in `claude` / `codex` CLI rewrites just those blocks in place. The replacement is sanitized server-side and spliced back, so the no-model-JavaScript rule holds even for model edits. (Demo GIF coming.)

## How it works

```
        an agent writes markdown / HTML  (content, never JS)
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
   | runtime (browser) |   ONE audited IIFE, zero npm deps
   | hydrates data-sh-*|   components. NO model-authored JS.
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

- **`/preview`** — render a markdown or HTML file into a beautiful, Notion-quality page, locally. The page is *alive*: select any passage and say what to change (your local `claude` / `codex` CLI makes the edit, free), chat with it, and persist small data (todos / lists).
- **`/publish`** — deploy that same page to a real URL with one pasted deploy token. The plumbing — a 4-digit PIN gate, a tiny todo/list store, an optional LLM proxy, a personal hub — is deliberately boring. The point isn't the publish; it's that what you publish keeps thinking and editing itself, safely.

## Security

The sanitizer is the keystone: model-authored HTML can never carry script, because every byte passes a closed-allowlist DOMPurify + jsdom pass before it touches a page. The receipts are in [`test/security-corpus.test.ts`](test/security-corpus.test.ts) — real, sourced XSS / mutation-XSS / DOMPurify-bypass vectors (OWASP, cure53, PortSwigger) run through the *shipped* sanitizer with structural assertions, on every CI run. The honest threat model (what it covers and what it doesn't) is in [SECURITY.md](SECURITY.md).

## What it is not

- Not an app builder. Data is a small primitive (todos, lists, counters), not an arbitrary backend.
- Not for PHI. It is a public-CDN, PIN-gated host with no BAA and no HIPAA controls.

## License

MIT.
