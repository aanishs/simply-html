// The formula AST. A closed, READ-ONLY expression grammar: there is deliberately no
// assignment, statement, loop, or function-definition node. Formulas can only READ from a
// scope and call a fixed registry of pure functions, so a formula can never mutate state,
// pollute a prototype, or define behavior. All mutation happens through declarative actions
// (a separate, closed mechanism), never through a formula. This is keystone #2 of the
// "model writes content, never code" design: the formula evaluator is an AST interpreter,
// never `eval` / `new Function`.

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "ident"; name: string } // scope lookup (a data field), NEVER a JS global
  | { t: "member"; obj: Node; key: string } // obj.key — vectorizes over arrays
  | { t: "call"; name: string; args: Node[] } // name MUST be in the closed registry
  | { t: "unary"; op: "not" | "-"; expr: Node }
  | { t: "binary"; op: BinaryOp; left: Node; right: Node }
  | { t: "where"; coll: Node; pred: Node }; // `coll where pred` -> filtered array

export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "and" | "or";

export type Scope = Record<string, unknown>;

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}
