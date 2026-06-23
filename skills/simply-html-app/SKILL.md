---
name: simply-html-app
description: |
  Author a small REACTIVE app (a "mini productivity app") as a simply-html page — a habit
  tracker, checklist, tally, planner, dashboard, or any data+interaction widget — using only
  HTML, read-only formulas, and the closed data-sh-* directive set. The model writes NO
  JavaScript and NO CSS; the audited runtime supplies behavior and the host supplies design.
  Use when asked to "make this interactive", "turn this into a little app", "add a form /
  counter / checklist that actually works", "build a habit tracker / planner page", or when a
  plan would be clearer as something you can poke at rather than read. For a read-only page,
  use simply-html-preview instead.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# simply-html-app — author a reactive app, no JS, no CSS

simply-html apps are HTML + read-only **formulas** + a closed set of `data-sh-*` directives. The
runtime makes them live; you never write a line of JavaScript or CSS. **Read
[`AUTHORING.md`](../../AUTHORING.md) — it is the full contract.** This skill is the workflow.

## Workflow

1. **Model the state.** Decide the JSON shape and put it in `data-sh-state` on a `[data-sh-app]`
   wrapper. Keep it small and flat.
2. **Render it** with `data-sh-text` / `data-sh-show` / `data-sh-repeat`, using formulas for
   anything derived (`count(todos where done)`), never duplicated state.
3. **Wire interaction** with `data-sh-on` and the closed actions (`toggle`/`set`/`inc`/`add`/
   `remove`) and `data-sh-bind` for inputs. Top-level writes use `$` (`set($, 'draft', '')`).
4. **Factor repetition** into a `data-sh-def` component, stamped with `data-sh-use` + `data-sh-arg-*`.
5. **Preview** to check it: `simply-html preview <file.html>` (or
   `node /path/to/simply-html/dist/cli/index.js preview <file.html>`), then open the printed URL.

## The non-negotiable rules

- **No JavaScript.** No `<script>`, no `on*`, no `javascript:` URLs. Behavior = directives + the
  closed action registry only.
- **No CSS.** No `<style>`, no `style=`. Use the semantic classes from `simply-html-design`; if a
  look isn't covered, that's a design-system gap, not a reason to write CSS.
- **Formulas read, actions write.** A formula can never mutate state; the only mutations are the
  five actions. State only lives in `data-sh-state` — never mirror it in the DOM.
- **Forms are inert.** `<input>`/`<button>`/`<textarea>`/`<label>` are fine; `<form>`/`<select>`
  are not. Controls do nothing except through `data-sh-bind` / `data-sh-on`.

## Minimal skeleton

```html
<div data-sh-app data-sh-state='{"draft":"","todos":[]}'>
  <p data-sh-text="count(todos where done) + ' / ' + count(todos)"></p>

  <ul data-sh-repeat="todos" data-sh-as="t">
    <li>
      <button data-sh-on="click: toggle(t, 'done')" data-sh-text="t.text"></button>
      <button data-sh-on="click: remove(todos, t)">×</button>
    </li>
  </ul>

  <input data-sh-bind="draft" placeholder="Add…">
  <button data-sh-on="click: add(todos, {text: draft, done: false}); set($, 'draft', '')">Add</button>
</div>
```

Worked example: [`examples/habit-tracker.html`](../../examples/habit-tracker.html). Full grammar:
[`AUTHORING.md`](../../AUTHORING.md). To deploy behind a PIN, use `simply-html-publish`.
