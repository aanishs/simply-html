// Public surface for the formula language. Parse once, evaluate many times against changing
// state — that is the reactive case (a `$computed` re-runs the compiled formula whenever its
// inputs change). Parsing is what validates the grammar; evaluation is the sandboxed walk.
import { parse } from "./parse.js";
import { evaluate } from "./evaluate.js";
import { FormulaError, type Node, type Scope } from "./types.js";

export { FormulaError } from "./types.js";
export type { Node, Scope } from "./types.js";
export { FORMULA_FUNCTIONS } from "./evaluate.js";

/** Parse + evaluate a formula in one shot. Throws FormulaError on a bad formula. */
export function evalFormula(src: string, scope: Scope = {}): unknown {
  return evaluate(parse(src), scope);
}

/** Parse a formula once into a reusable evaluator. The AST is fixed; only the scope varies. */
export function compileFormula(src: string): (scope?: Scope) => unknown {
  const ast: Node = parse(src);
  return (scope: Scope = {}) => evaluate(ast, scope);
}

/** Validate a formula without running it (parse-only). Returns the error message, or null. */
export function checkFormula(src: string): string | null {
  try {
    parse(src);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : String(e);
  }
}
