# simply-html

**Publish a page your AI agent can safely keep editing.** simply-html turns the markdown/HTML an agent already makes into a live page you can read, talk to, and edit by selecting text — and it stays safe to host behind a shared link, because the model writes *content*, never JavaScript.

> Status: early build (v0). Working name.

## The one rule (the whole point)

**The model writes content, never JavaScript.** Every interactive part — select-to-edit, the chat pod, todo binding, the LLM and data calls — lives in one audited runtime that ships with simply-html. The model only ever emits HTML, markdown, and a fixed set of declarative `data-*` hooks.

That is what makes a *model-edited* page safe to host behind a shared link: there is no model-authored script to smuggle an attack through, just sanitized content. It is the one thing the agent-HTML tools around it structurally can't do — Anthropic Artifacts sandboxes the network off, so its pages can't think or persist; Codex Sites and the live-JS hosts run model-written JavaScript, so a shared, model-edited page isn't safe. simply-html sits in exactly that gap.

## The two skills

- **`/preview`** — render a markdown or HTML file into a beautiful, Notion-quality page, locally. The page is *alive*: select any passage and say what to change (your logged-in `claude` / `codex` CLI makes the edit, free), chat with it, and persist small data (todos / lists).
- **`/publish`** — deploy that same page to a real URL with one pasted deploy token. The plumbing — a 4-digit PIN gate, a tiny todo/list store, an optional LLM proxy, a personal hub — is deliberately boring. The point isn't the publish; it's that what you publish keeps thinking and editing itself, safely.

## What it is not

- Not an app builder. Data is a small primitive (todos, lists, counters), not an arbitrary backend.
- Not for PHI. It is a public-CDN, PIN-gated host with no BAA and no HIPAA controls.

## License

MIT.
