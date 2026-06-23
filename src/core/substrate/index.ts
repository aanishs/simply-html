// Public surface for the substrate runtime: mount a reactive view from authored `data-sh-*`
// markup. Pair with the sanitizer (which gates which directives may appear) for the full
// safety story — model writes HTML + formulas, never JavaScript.
export { mountApp } from "./mount.js";
export type { AppHandle } from "./mount.js";
export { ACTIONS, ACTION_NAMES, type Action } from "./actions.js";
