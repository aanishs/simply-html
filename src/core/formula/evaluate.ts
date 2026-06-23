// The sandboxed evaluator. A formula is a pure AST walk over a plain data `scope`:
//   - NO `eval` / `new Function` anywhere.
//   - Identifiers resolve ONLY to own properties of `scope` (a data object), never to JS
//     globals (`globalThis`, `window`, `process` are simply "not in scope" -> undefined).
//   - Member access blocks `__proto__` / `constructor` / `prototype` and reads only OWN
//     properties, so there is no path to a constructor, prototype, or the Function object.
//   - Calls resolve ONLY against the closed FUNCTIONS registry; an unknown function throws.
//   - A fuel counter bounds total work, and collections are size-capped, so a formula cannot
//     hang the page.
// Together these make formula-injection structurally impossible rather than filtered.
import { FormulaError, isForbiddenKey, type Node, type Scope } from "./types.js";

const MAX_ITEMS = 100_000; // largest collection a `where`/vectorize may touch
const DEFAULT_FUEL = 500_000; // max node evaluations per formula

interface Ctx {
  fuel: number;
}

const truthy = (v: unknown): boolean => v !== false && v != null && v !== 0 && v !== "" && !(Array.isArray(v) && v.length === 0);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v));

/** Read OWN property `key` off a single value; blocks dangerous keys; no prototype walk. */
function plainGet(obj: unknown, key: string): unknown {
  if (isForbiddenKey(key)) throw new FormulaError(`access to '${key}' is not allowed`);
  if (obj == null) return undefined;
  if (typeof obj === "string") return key === "length" ? obj.length : undefined;
  if (typeof obj !== "object") return undefined;
  if (Array.isArray(obj)) return key === "length" ? obj.length : undefined;
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

type Fn = (args: unknown[]) => unknown;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const nums = (v: unknown): number[] => arr(v).map(num).filter((x) => !Number.isNaN(x));

// The closed registry of pure functions. Adding a function is a deliberate, audited act.
const FUNCTIONS: Record<string, Fn> = {
  count: (a) => arr(a[0]).length,
  sum: (a) => nums(a[0]).reduce((x, y) => x + y, 0),
  avg: (a) => { const n = nums(a[0]); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : 0; },
  // reduce, never Math.min(...spread): a large collection would blow the call-stack arg limit
  min: (a) => { const n = nums(a[0]); return n.length ? n.reduce((x, y) => (y < x ? y : x)) : null; },
  max: (a) => { const n = nums(a[0]); return n.length ? n.reduce((x, y) => (y > x ? y : x)) : null; },
  len: (a) => (typeof a[0] === "string" ? a[0].length : arr(a[0]).length),
  abs: (a) => Math.abs(num(a[0])),
  round: (a) => Math.round(num(a[0])),
  floor: (a) => Math.floor(num(a[0])),
  ceil: (a) => Math.ceil(num(a[0])),
  if: (a) => (truthy(a[0]) ? a[1] : a[2] ?? null),
  lower: (a) => String(a[0] ?? "").toLowerCase(),
  upper: (a) => String(a[0] ?? "").toUpperCase(),
  contains: (a) => {
    const hay = a[0];
    if (typeof hay === "string") return hay.includes(String(a[1] ?? ""));
    return arr(hay).includes(a[1]);
  },
  not: (a) => !truthy(a[0]),
};

function evalNode(node: Node, scope: Scope, ctx: Ctx): unknown {
  if (--ctx.fuel < 0) throw new FormulaError("formula exceeded its evaluation budget");

  switch (node.t) {
    case "num": return node.v;
    case "str": return node.v;
    case "bool": return node.v;
    case "null": return null;

    case "ident":
      if (isForbiddenKey(node.name)) throw new FormulaError(`access to '${node.name}' is not allowed`);
      return Object.prototype.hasOwnProperty.call(scope, node.name) ? scope[node.name] : undefined;

    case "member": {
      const o = evalNode(node.obj, scope, ctx);
      if (isForbiddenKey(node.key)) throw new FormulaError(`access to '${node.key}' is not allowed`);
      if (Array.isArray(o)) {
        if (node.key === "length") return o.length;
        if (o.length > MAX_ITEMS) throw new FormulaError("collection too large");
        return o.map((item) => plainGet(item, node.key)); // vectorize over the array
      }
      return plainGet(o, node.key);
    }

    case "unary": {
      const v = evalNode(node.expr, scope, ctx);
      return node.op === "not" ? !truthy(v) : -num(v);
    }

    case "binary": {
      // short-circuit logical ops
      if (node.op === "and") return truthy(evalNode(node.left, scope, ctx)) ? truthy(evalNode(node.right, scope, ctx)) : false;
      if (node.op === "or") return truthy(evalNode(node.left, scope, ctx)) ? true : truthy(evalNode(node.right, scope, ctx));
      const l = evalNode(node.left, scope, ctx);
      const r = evalNode(node.right, scope, ctx);
      switch (node.op) {
        case "+": return typeof l === "string" || typeof r === "string" ? String(l ?? "") + String(r ?? "") : num(l) + num(r);
        case "-": return num(l) - num(r);
        case "*": return num(l) * num(r);
        case "/": return num(l) / num(r);
        case "%": return num(l) % num(r);
        case "==": return l === r;
        case "!=": return l !== r;
        case "<": return num(l) < num(r);
        case "<=": return num(l) <= num(r);
        case ">": return num(l) > num(r);
        case ">=": return num(l) >= num(r);
      }
      return undefined;
    }

    case "where": {
      const coll = evalNode(node.coll, scope, ctx);
      if (!Array.isArray(coll)) return [];
      if (coll.length > MAX_ITEMS) throw new FormulaError("collection too large");
      return coll.filter((item) => {
        // predicate scope: the item's own fields, falling back to the outer scope
        const itemScope: Scope = item && typeof item === "object" && !Array.isArray(item)
          ? { ...scope, ...(item as Scope) }
          : scope;
        return truthy(evalNode(node.pred, itemScope, ctx));
      });
    }

    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`unknown function '${node.name}'`);
      const args = node.args.map((a) => evalNode(a, scope, ctx));
      return fn(args);
    }

    case "array":
      if (node.items.length > MAX_ITEMS) throw new FormulaError("array literal too large");
      return node.items.map((item) => evalNode(item, scope, ctx));

    case "object": {
      // a fresh plain object built from literal keys; a dangerous key can never be introduced,
      // so an object literal cannot pollute a prototype.
      const obj: Record<string, unknown> = {};
      for (const [key, valNode] of node.entries) {
        if (isForbiddenKey(key)) throw new FormulaError(`key '${key}' is not allowed`);
        obj[key] = evalNode(valNode, scope, ctx);
      }
      return obj;
    }
  }
}

export function evaluate(node: Node, scope: Scope = {}, fuel: number = DEFAULT_FUEL): unknown {
  return evalNode(node, scope, { fuel });
}

export const FORMULA_FUNCTIONS = Object.freeze(Object.keys(FUNCTIONS));
