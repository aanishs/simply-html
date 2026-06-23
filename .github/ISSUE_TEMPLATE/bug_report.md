---
name: Bug report
about: Something rendered, sanitized, or behaved wrong
title: ""
labels: bug
assignees: ""
---

**What happened**
A clear description of the bug.

**Repro**
The smallest input that triggers it — the markdown/HTML you fed in, the command you ran, or a
minimal `data-sh-*` snippet. A failing test is gold.

**Expected**
What you expected instead.

**Environment**
- simply-html version / commit:
- Node version:
- OS / browser (if relevant):

> ⚠️ For a **security** issue (a way to get script, an `on*` handler, a dangerous URL, or a
> forbidden tag/attribute past the sanitizer or the substrate runtime), please use a private
> security advisory instead of a public issue. See [SECURITY.md](../../SECURITY.md).
