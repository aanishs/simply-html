---
name: Idea / feature
about: Suggest a directive, function, skill, or capability
title: ""
labels: enhancement
assignees: ""
---

**The idea**
What you'd like simply-html to do.

**Why**
The use case — what you're trying to author, and what's awkward or impossible today.

**Fit check (helps a lot)**
- Does it keep the rule that **the model writes content, never JavaScript or CSS**? If it needs
  new interactivity, can it live in the runtime behind a closed `data-sh-*` directive/action
  rather than as model-authored code?
- If it touches the sanitizer allowlist, what's the security rationale?

See [AUTHORING.md](../../AUTHORING.md) for the current grammar and [SECURITY.md](../../SECURITY.md)
for the constraints.
