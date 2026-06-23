# Contributing to simply-html

Thanks for taking a look 👋 — this is a small, experimental project, and contributions,
issues, and "huh, what about…" questions are all welcome.

## The one principle (please internalize this)

**The model writes content, never JavaScript — and never CSS.** Everything interactive lives in
one audited runtime; everything visual lives in the host's design system. That constraint *is* the
project. A change that lets model-authored markup carry script, inline styles, or arbitrary
attributes is a regression even if it "works," because the whole point is that a model-edited page
stays safe to host behind a shared link. When in doubt, read [SECURITY.md](SECURITY.md) and
[AUTHORING.md](AUTHORING.md).

## Getting set up

```bash
git clone https://github.com/aanishs/simply-html && cd simply-html
npm install
npm run build        # bundles the browser runtime IIFE + the CLI
npm test             # vitest — must stay green
npm run typecheck    # tsc --noEmit — must stay clean
```

Try it locally:

```bash
node dist/cli/index.js preview examples/test-page.html      # a reading page
node dist/cli/index.js preview examples/habit-tracker.html  # a reactive app (no JS authored)
```

## How the code is laid out

- `src/core/` — shared, environment-agnostic logic: `sanitize/` (the keystone), `render/`,
  `formula/` (the read-only expression sandbox), `reactive/` (signals), `substrate/` (the app
  runtime), `edit/`, `scan/`.
- `src/runtime/` — the browser IIFE that hydrates `data-sh-*` (no npm deps).
- `src/cli/` + `src/function/` — the local bridge daemon and the deployed serverless function.
- `test/` — vitest. `security-corpus.test.ts` is the adversarial corpus.
- `skills/` — the Claude Code skills (`-preview`, `-publish`, `-app`, `-design`, `-brand`).

## The most useful contribution: a security vector

If you find a way to get script, an `on*` handler, a dangerous URL, prototype pollution, or any
forbidden tag/attribute past the sanitizer **or** the substrate runtime — that is the highest-value
report there is. The best form is a failing test added to `test/security-corpus.test.ts` (or
`test/substrate.test.ts`) with a sourced payload. See [SECURITY.md](SECURITY.md) for the threat
model and reporting (use a private advisory for anything sensitive).

## Pull requests

- Keep the diff focused; match the surrounding style (the code is heavily commented on purpose —
  explain *why*, not *what*).
- `npm test` and `npm run typecheck` must pass. New behavior needs a test.
- New interactivity belongs in the runtime behind a closed `data-sh-*` directive or action — never
  as model-authored JS, and never by widening the sanitizer allowlist without a security rationale
  and a corpus test.
- New design belongs in the host's class allowlist + stylesheet, not in per-page CSS.

## Code of conduct

Be kind and assume good faith. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
