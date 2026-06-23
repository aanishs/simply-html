// The closed set of state mutations a page may declare via `data-sh-on`. Formulas are
// read-only by construction (no assignment node exists), so THIS registry is the *only* way
// authored markup changes state — and it is fixed and audited, not a general assignment
// facility. Each action receives arguments the formula evaluator already resolved from state
// (an item object, a collection array, a literal), mutates that reference in place, and the
// runtime then bumps the store to re-render. There is deliberately no `eval`, no path strings,
// and no way to reach a prototype: every field name is checked against the same blocklist the
// evaluator uses.
import { FormulaError, isForbiddenKey } from "../formula/index.js";

const MAX_COLLECTION = 10_000; // an `add` cannot grow a collection without bound

function asObject(v: unknown, action: string): Record<string, unknown> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) {
    throw new FormulaError(`${action}: target must be an object`);
  }
  return v as Record<string, unknown>;
}

function asField(v: unknown, action: string): string {
  if (typeof v !== "string") throw new FormulaError(`${action}: field name must be a string`);
  // reject __proto__/constructor/prototype AND toString/valueOf/hasOwnProperty/... — writing an
  // own copy of any built-in member shadows it and breaks later coercion (a state-corruption DoS).
  if (isForbiddenKey(v)) throw new FormulaError(`${action}: field '${v}' is not allowed`);
  return v;
}

const num = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0;

export type Action = (args: unknown[]) => void;

// Adding an action is a deliberate, audited act — like adding a formula function.
export const ACTIONS: Record<string, Action> = {
  // toggle(item, "done") — flip a boolean field
  toggle: (a) => { const o = asObject(a[0], "toggle"); const f = asField(a[1], "toggle"); o[f] = !o[f]; },

  // set(item, "field", value) — assign a field to a value
  set: (a) => { const o = asObject(a[0], "set"); const f = asField(a[1], "set"); o[f] = a[2]; },

  // inc(item, "count", 1) — add to a numeric field (amount defaults to +1)
  inc: (a) => {
    const o = asObject(a[0], "inc");
    const f = asField(a[1], "inc");
    o[f] = num(o[f]) + (a[2] === undefined ? 1 : num(a[2]));
  },

  // add(collection, value) — append a value (typically an object literal) to an array
  add: (a) => {
    const coll = a[0];
    if (!Array.isArray(coll)) throw new FormulaError("add: target must be a collection");
    if (coll.length >= MAX_COLLECTION) throw new FormulaError("add: collection is full");
    coll.push(a[1]);
  },

  // remove(collection, item) — drop an item from an array
  remove: (a) => {
    const coll = a[0];
    if (!Array.isArray(coll)) throw new FormulaError("remove: target must be a collection");
    const i = coll.indexOf(a[1]);
    if (i >= 0) coll.splice(i, 1);
  },
};

export const ACTION_NAMES = Object.freeze(Object.keys(ACTIONS));
