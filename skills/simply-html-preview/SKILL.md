---
name: simply-html-preview
description: |
  Render a markdown or HTML file into a beautiful, Notion-quality page you can read, talk
  to, and edit by selecting text and saying what to change — your logged-in claude/codex
  CLI makes the edit, for free. The page is alive but safe: the model writes content, never
  JavaScript. It can also persist small data (todos/lists). Use when asked to "preview this
  page", "render this markdown nicely", "open this as a real page", "make this readable",
  "edit this by selecting text", or to look at an agent-generated HTML/markdown artifact as
  a real document instead of raw text.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# simply-html-preview — render + serve a page locally

Turn a markdown or HTML file into a polished, readable page served at `127.0.0.1`.
Reading works with zero setup; interactive `data-sh-*` components (todo, list,
counter, tabs, callout) are hydrated by simply-html's one audited runtime.

## How to run it

```bash
simply-html preview <file.md|file.html>
```

(If simply-html is not globally installed, run it from the repo:
`node /path/to/simply-html/dist/cli/index.js preview <file>`.)

It prints the page URL as the first line:

```
URL: http://127.0.0.1:<port>/p/<id>
```

Relay the `URL` to the user. The shared bridge keeps serving in the background, so this
command returns immediately — there is no process to keep alive. Run `simply-html bridge`
to run the daemon in the foreground and watch its logs.

## Rules & behavior

- **The model writes content, never JavaScript.** Interactivity comes from the runtime,
  not from per-page scripts. A page is HTML/markdown plus a closed set of
  `data-sh-*` hooks.
- **Markdown** renders through the reading template (`html:false`, so raw HTML inside a
  `.md` is escaped). A **raw HTML** file is hosted as-is but always passes through the
  sanitizer first.
- **Reading + simple components** (todo, list, counter, tabs, callout) are this skill's scope.
  For a full **reactive app** (derived state, two-way inputs, components), use the
  `simply-html-app` skill and the grammar in `AUTHORING.md`. Either way the model writes no JS.
- **Never publish PHI.** Preview is local; `simply-html publish` runs a pre-publish scan.

## Declaring interactive components (HTML input)

```html
<div data-sh-component="todo" data-sh-key="groceries" data-sh-label="Groceries">
  <ul><li>Oat milk</li><li>Eggs</li></ul>
</div>
<div data-sh-component="counter" data-sh-key="water" data-sh-min="0" data-sh-max="12" data-sh-default="3"></div>
```

To deploy a page to a real URL behind a PIN, use the `simply-html-publish` skill.
