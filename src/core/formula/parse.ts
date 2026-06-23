// Recursive-descent parser. Precedence (low -> high):
//   where  <  or  <  and  <  comparison  <  +/-  <  * / %  <  unary(not,-)  <  postfix(.member, call)
// Calls are ONLY `<ident>(args...)` resolved later against a closed registry; there is no way
// to call a member expression (so `x.constructor(...)` can never be a call) and no computed
// member access (`x[expr]`), because `[` is not a token.
import { tokenize, type Tok } from "./tokenize.js";
import { FormulaError, type Node, type BinaryOp } from "./types.js";

const MAX_DEPTH = 48; // bounds nesting like ((((...)))) so the parser can't stack-overflow

export function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  let depth = 0;

  const peek = (): Tok => toks[pos]!;
  const next = (): Tok => toks[pos++]!;
  const eat = (kind: Tok["kind"], what: string): Tok => {
    if (peek().kind !== kind) throw new FormulaError(`expected ${what}, got ${JSON.stringify(peek().value || peek().kind)}`);
    return next();
  };
  const isKw = (w: string): boolean => peek().kind === "kw" && peek().value === w;

  function descend<T>(fn: () => T): T {
    if (++depth > MAX_DEPTH) throw new FormulaError("formula nested too deep");
    try { return fn(); } finally { depth--; }
  }

  // where (lowest)
  function parseWhere(): Node {
    let left = parseOr();
    while (isKw("where")) {
      next();
      const pred = descend(parseOr);
      left = { t: "where", coll: left, pred };
    }
    return left;
  }
  function parseOr(): Node {
    let left = parseAnd();
    while (isKw("or")) { next(); left = { t: "binary", op: "or", left, right: descend(parseAnd) }; }
    return left;
  }
  function parseAnd(): Node {
    let left = parseCmp();
    while (isKw("and")) { next(); left = { t: "binary", op: "and", left, right: descend(parseCmp) }; }
    return left;
  }
  function parseCmp(): Node {
    let left = parseAdd();
    while (["==", "!=", "<", "<=", ">", ">="].includes(peek().kind)) {
      const op = next().kind as BinaryOp;
      left = { t: "binary", op, left, right: descend(parseAdd) };
    }
    return left;
  }
  function parseAdd(): Node {
    let left = parseMul();
    while (peek().kind === "+" || peek().kind === "-") {
      const op = next().kind as BinaryOp;
      left = { t: "binary", op, left, right: descend(parseMul) };
    }
    return left;
  }
  function parseMul(): Node {
    let left = parseUnary();
    while (peek().kind === "*" || peek().kind === "/" || peek().kind === "%") {
      const op = next().kind as BinaryOp;
      left = { t: "binary", op, left, right: descend(parseUnary) };
    }
    return left;
  }
  function parseUnary(): Node {
    if (isKw("not")) { next(); return { t: "unary", op: "not", expr: descend(parseUnary) }; }
    if (peek().kind === "-") { next(); return { t: "unary", op: "-", expr: descend(parseUnary) }; }
    return parsePostfix();
  }
  function parsePostfix(): Node {
    let node = parsePrimary();
    for (;;) {
      if (peek().kind === ".") {
        next();
        const key = eat("ident", "property name").value;
        node = { t: "member", obj: node, key };
      } else {
        return node;
      }
    }
  }
  // one `key: value` entry of an object literal. The key is a literal name (ident or string),
  // never an expression — there is no computed-key form, so a key can't be derived at runtime.
  function parseEntry(): [string, Node] {
    const k = peek();
    let key: string;
    if (k.kind === "ident" || k.kind === "str") key = next().value;
    else if (k.kind === "kw") key = next().value; // allow words like `done`, `true` as keys
    else throw new FormulaError(`expected object key, got ${JSON.stringify(k.value || k.kind)}`);
    eat(":", "':'");
    return [key, descend(parseWhere)];
  }
  function parsePrimary(): Node {
    const t = peek();
    switch (t.kind) {
      case "num": next(); return { t: "num", v: Number(t.value) };
      case "str": next(); return { t: "str", v: t.value };
      case "(": {
        next();
        const inner = descend(parseWhere);
        eat(")", "')'");
        return inner;
      }
      case "[": { // array literal: [a, b, c]
        next();
        const items: Node[] = [];
        if (peek().kind !== "]") {
          items.push(descend(parseWhere));
          while (peek().kind === ",") { next(); items.push(descend(parseWhere)); }
        }
        eat("]", "']'");
        return { t: "array", items };
      }
      case "{": { // object literal: {key: value, ...} — keys are bare idents or strings, never computed
        next();
        const entries: Array<[string, Node]> = [];
        if (peek().kind !== "}") {
          entries.push(parseEntry());
          while (peek().kind === ",") { next(); entries.push(parseEntry()); }
        }
        eat("}", "'}'");
        return { t: "object", entries };
      }
      case "kw":
        if (t.value === "true") { next(); return { t: "bool", v: true }; }
        if (t.value === "false") { next(); return { t: "bool", v: false }; }
        if (t.value === "null") { next(); return { t: "null" }; }
        throw new FormulaError(`unexpected keyword '${t.value}'`);
      case "ident": {
        next();
        if (peek().kind === "(") { // function call: name(args)
          next();
          const args: Node[] = [];
          if (peek().kind !== ")") {
            args.push(descend(parseWhere));
            while (peek().kind === ",") { next(); args.push(descend(parseWhere)); }
          }
          eat(")", "')'");
          return { t: "call", name: t.value, args };
        }
        return { t: "ident", name: t.value };
      }
      default:
        throw new FormulaError(`unexpected ${JSON.stringify(t.value || t.kind)}`);
    }
  }

  const node = parseWhere();
  if (peek().kind !== "eof") throw new FormulaError(`unexpected trailing ${JSON.stringify(peek().value || peek().kind)}`);
  return node;
}
