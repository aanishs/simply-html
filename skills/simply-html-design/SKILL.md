---
name: simply-html-design
description: |
  The locked design contract for simply-html pages and apps. It exists to answer one question:
  "how do I make this look good?" — and the answer is that you DON'T write CSS. The model never
  authors styles; the host's design system owns the look, and you express meaning with a small
  set of semantic class names. Use when tempted to add <style>, style=, custom classes, colors,
  or layout CSS to a simply-html page, or when asked "style this", "make it pretty", "add some
  design" — this skill explains what to do instead.
allowed-tools:
  - Read
---

# simply-html-design — the look is locked; you write meaning, not CSS

simply-html separates **structure** (your HTML), **behavior** (the runtime, via `data-sh-*`), and
**design** (the host's stylesheet). You author the first two. **You do not author design.** This
is both a safety rule and a quality rule: model-authored CSS is an injection/exfiltration surface
*and* it drifts into inconsistent, ugly pages. So the rule is locked.

## The rule

- **Never write `<style>` or `style=`.** They are stripped by the sanitizer anyway.
- **Never invent class names.** Only allowlisted classes survive on a hosted page (this applies to
  both static `class` and reactive `data-sh-class`), so a made-up class is silently dropped and
  does nothing.
- **Express meaning, not appearance.** Say "this is a success callout," not "this is green." The
  host decides what success *looks* like, consistently, across every page.

## The semantic vocabulary you may use

| Class | Use it for |
|---|---|
| `sh-callout` | a boxed callout; combine with a tone below |
| `info` / `success` / `warn` / `danger` / `note` | the tone of a callout or inline emphasis |

```html
<div class="sh-callout success">Saved.</div>
<div class="sh-callout warn">This can't be undone.</div>
```

Reading-content classes (`task-list-item`, `contains-task-list`, …) and component classes
(`sh-todo`, `sh-counter`, `sh-tabs`, …) are managed by the runtime — you declare components with
`data-sh-component` / the `data-sh-*` app directives, not by hand-writing those classes.

## When the look you want isn't covered

That is a **design-system gap**, and the fix is to extend the host's design system — add the
class + its styling to the allowlist and stylesheet deliberately — not to write one-off CSS in a
page. Authoring a page is not the place to make design decisions; raise the gap, keep the page
semantic, and let the locked system render it. A richer app-styling vocabulary is the host's
roadmap, not the model's to improvise.

For the authoring grammar (directives, formulas, actions, components), see
[`AUTHORING.md`](../../AUTHORING.md) and the `simply-html-app` skill.
