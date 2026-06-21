---
name: simply-html-publish
description: |
  Deploy a markdown or HTML page to a real public URL behind a 4-digit PIN, with a tiny
  managed data store (todos/lists) and an optional LLM proxy — using only a pasted Vercel
  token. Every page lands in your personal hub. Use when asked to "publish this page",
  "give me a real link", "put this online behind a PIN", "deploy this with a todo list",
  or "add a password to this page". The model writes content, never JavaScript.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# simply-html-publish — deploy a page behind a PIN

> `simply-html publish <file>` renders the page, bakes it + the runtime into one serverless
> function, deploys to Vercel with only a token, turns OFF Vercel's own SSO so the PIN gate is
> the only gate, and returns a PIN-gated public URL. `--db` adds a Vercel Blob data store
> (todos/lists); `--llm` adds the deployed model proxy.

## Intended usage

```bash
export VERCEL_TOKEN=…            # the only credential for the golden path
simply-html publish <file.md>
simply-html publish <file.html> --db                # + a todo/list store (6-digit PIN)
simply-html publish <file.html> --db --llm          # + a BYO-key LLM proxy
```

Planned output (relay `URL` + `ACCESS` together):

```
URL: https://sh-<slug>.vercel.app
HUB: https://sh-<slug>.vercel.app/hub
DOC: <doc-id>
ACCESS: PIN 4827   (enter once, stays unlocked 30 days)
```

## Rules & behavior

- **One key, one function.** The publish-a-doc golden path needs only `VERCEL_TOKEN`.
  `--db` uses Vercel Blob (provisioned with the same token); `--llm` adds one model key.
- **PIN, not auth.** A 4-digit PIN for read-only docs; **6-digit required** when `--db`
  or `--llm` is on (a writable/spend-capable page). Hashed server-side, never shipped to
  the client, rate-limited against brute force.
- **No PHI.** A pre-publish secret/PHI scan runs before anything leaves the machine;
  blocked content refuses to publish.
- **The model writes content, never JavaScript** (enforced by the sanitizer + the closed
  component vocabulary).
