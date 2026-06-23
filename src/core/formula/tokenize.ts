// Lexer for the formula language. Hand-rolled (no regex engine on untrusted input beyond
// simple char classes) so token boundaries are explicit and bounded.
import { FormulaError } from "./types.js";

export type TokKind =
  | "num" | "str" | "ident" | "kw"
  | "(" | ")" | "," | "." | "[" | "]" | "{" | "}" | ":"
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "eof";

export interface Tok {
  kind: TokKind;
  value: string; // raw text (for ident/kw) or the parsed literal (for num/str)
  pos: number;
}

const KEYWORDS = new Set(["and", "or", "not", "where", "true", "false", "null"]);
const MAX_LEN = 4000; // a single formula longer than this is rejected outright

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
// `$` is allowed so a binding/action can name the state root as `$` (e.g. set($, 'draft', '')).
const isIdentStart = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

export function tokenize(src: string): Tok[] {
  if (src.length > MAX_LEN) throw new FormulaError("formula too long");
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;

    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }

    // numbers (no leading sign; unary minus is parsed separately)
    if (isDigit(c)) {
      const start = i;
      while (i < n && isDigit(src[i]!)) i++;
      if (i < n && src[i] === "." && isDigit(src[i + 1] ?? "")) {
        i++;
        while (i < n && isDigit(src[i]!)) i++;
      }
      out.push({ kind: "num", value: src.slice(start, i), pos: start });
      continue;
    }

    // strings: '...' or "..." with \\ and \" / \' escapes
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let s = "";
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          const next = src[i + 1];
          if (next === undefined) throw new FormulaError("unterminated escape");
          s += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
        } else {
          s += src[i];
          i++;
        }
      }
      if (i >= n) throw new FormulaError("unterminated string");
      i++; // closing quote
      out.push({ kind: "str", value: s, pos: start });
      continue;
    }

    // identifiers / keywords
    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdentPart(src[i]!)) i++;
      const word = src.slice(start, i);
      out.push({ kind: KEYWORDS.has(word) ? "kw" : "ident", value: word, pos: start });
      continue;
    }

    // multi-char operators
    const two = src.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      out.push({ kind: two as TokKind, value: two, pos: i });
      i += 2;
      continue;
    }

    // single-char punctuation/operators. `[` `{` `:` are used ONLY for array/object LITERALS
    // (prefix position); the parser never accepts a postfix `[`, so computed member access
    // (`x[expr]`) remains impossible — the read-only access story is unchanged.
    if ("()+-*/%<>,.[]{}:".includes(c)) {
      out.push({ kind: c as TokKind, value: c, pos: i });
      i++;
      continue;
    }

    // Anything else (=, &, |, !, ;, backtick, ...) is rejected. This is the belt that blocks
    // `=` (assignment), `;` (statement separator), template literals, bitwise ops, etc.
    throw new FormulaError(`unexpected character ${JSON.stringify(c)} at ${i}`);
  }

  out.push({ kind: "eof", value: "", pos: n });
  return out;
}
