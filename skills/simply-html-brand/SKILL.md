---
name: simply-html-brand
description: |
  Give your simply-html pages a light, authentic brand: one accent color, your logo, and an
  optional font. Applied minimally by design — links, rules, buttons, and a small header
  bar — never a heavy theme. Use when asked to "brand my pages", "use my logo/colors",
  "match our company look", "set the accent color", or "make the pages feel like us".
  Writes a simply-html.brand.json that every preview/publish picks up.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# simply-html-brand — a minimalist, authentic brand

simply-html stays intentionally plain by default. This skill adds just enough of your
identity to make pages feel like yours, without turning them into a billboard.

## How to run it

```bash
simply-html brand set --logo ./logo.png --accent "#2f6f6a" --name "Acme"
# -> embeds the logo + saves simply-html.brand.json (accent defaults to coral if omitted)
simply-html brand set --font "Source Serif 4" --density compact
simply-html brand show
```

Then any `simply-html preview` / `simply-html publish` from that directory picks it up.

## What it touches (and what it doesn't)

- **Accent** — links, the rule under H2s, buttons, the active tab underline, and the
  small header bar. Nothing else. Body text and surfaces stay neutral.
- **Logo + name** — a small, uppercase brand bar at the top of the page. The logo is
  embedded as a data URI so it travels with the page (works the same local and deployed).
- **Font** — body font only, validated. The default is Inter-class.
- **Density** — `comfortable` (default) or `compact` (tighter measure + leading).

## Rules

- **Minimalist on purpose.** One accent, one logo, one optional font. No palettes, no
  gradients, no per-element color overrides. If you want more, that is a different tool.
- **Accent is explicit.** Pass `--accent <hex>`; if you skip it, pages use the default
  coral. Set the color you want — there is no auto-derive-from-logo.
- **Resolution order** (later wins): `~/.simply-html/simply-html.brand.json` (global) →
  `./simply-html.brand.json` (cwd) → the page's own directory. A project can override your
  global look.
- Brand values are schema-validated before they ever reach CSS (injection-safe).
