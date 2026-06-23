import { describe, it, expect } from "vitest";
import { evalFormula, compileFormula, checkFormula, FormulaError } from "../src/core/formula/index.js";

const HABITS = {
  habits: [
    { name: "water", done: true },
    { name: "stretch", done: true },
    { name: "read", done: false },
  ],
  items: [
    { amount: 10, paid: true },
    { amount: 5, paid: false },
    { amount: 8, paid: true },
  ],
  streak: 4,
};

describe("formula / correctness", () => {
  it("evaluates literals + arithmetic with precedence", () => {
    expect(evalFormula("1 + 2 * 3")).toBe(7);
    expect(evalFormula("(1 + 2) * 3")).toBe(9);
    expect(evalFormula("10 / 4")).toBe(2.5);
    expect(evalFormula("10 % 3")).toBe(1);
    expect(evalFormula("-5 + 2")).toBe(-3);
  });

  it("comparison + logical (short-circuit)", () => {
    expect(evalFormula("3 > 2 and 2 > 1")).toBe(true);
    expect(evalFormula("3 < 2 or 2 > 1")).toBe(true);
    expect(evalFormula("not false")).toBe(true);
    expect(evalFormula('"a" == "a"')).toBe(true);
    expect(evalFormula("1 == 2")).toBe(false);
    expect(evalFormula("3 != 2")).toBe(true);
  });

  it("string concat + functions", () => {
    expect(evalFormula('"hi " + "there"')).toBe("hi there");
    expect(evalFormula('upper("hi")')).toBe("HI");
    expect(evalFormula('lower("HI")')).toBe("hi");
    expect(evalFormula("round(2.6)")).toBe(3);
    expect(evalFormula('if(1 > 0, "yes", "no")')).toBe("yes");
  });

  it("scope lookup + member access", () => {
    expect(evalFormula("streak", HABITS)).toBe(4);
    expect(evalFormula("habits.length", HABITS)).toBe(3);
    expect(evalFormula("habits.name", HABITS)).toEqual(["water", "stretch", "read"]); // vectorized
    expect(evalFormula("missing", HABITS)).toBeUndefined();
  });

  it("where filter + aggregates (the habit-tracker formulas)", () => {
    expect(evalFormula("count(habits)", HABITS)).toBe(3);
    expect(evalFormula("count(habits where done)", HABITS)).toBe(2);
    expect(evalFormula("count(habits where not done)", HABITS)).toBe(1);
    expect(evalFormula("count(habits where done) == count(habits)", HABITS)).toBe(false);
    expect(evalFormula('if(count(habits where done) == count(habits), "all done", "keep going")', HABITS)).toBe("keep going");
  });

  it("filter then project then aggregate", () => {
    expect(evalFormula("sum((items where paid).amount)", HABITS)).toBe(18);
    expect(evalFormula("sum(items.amount)", HABITS)).toBe(23);
    expect(evalFormula("max((items where paid).amount)", HABITS)).toBe(10);
  });

  it("compileFormula reuses the AST across scopes", () => {
    const f = compileFormula("count(habits where done)");
    expect(f({ habits: [{ done: true }] })).toBe(1);
    expect(f({ habits: [{ done: false }, { done: true }, { done: true }] })).toBe(2);
  });

  it("checkFormula validates without running", () => {
    expect(checkFormula("count(habits where done)")).toBeNull();
    expect(checkFormula("count(habits where")).not.toBeNull();
  });
});

describe("formula / safety — injection is structurally blocked", () => {
  const mustThrow = (src: string, scope = {}) =>
    expect(() => evalFormula(src, scope), src).toThrow(FormulaError);

  it("blocks prototype-chain escape keys", () => {
    mustThrow("habits.constructor", HABITS);
    mustThrow("habits.__proto__", HABITS);
    mustThrow("habits.prototype", HABITS);
    mustThrow('habits.constructor', HABITS);
    mustThrow("streak.constructor", HABITS);
    // the classic RCE shape: x.constructor.constructor("...")()  -> dies at the first hop
    mustThrow('habits.constructor.constructor("return process")', HABITS);
    mustThrow("__proto__", HABITS); // bare ident form
  });

  it("blocks calls to anything outside the closed registry", () => {
    mustThrow('eval("1+1")');
    mustThrow("alert(1)");
    mustThrow('require("fs")');
    mustThrow("setTimeout(1)");
    mustThrow("fetch(1)");
  });

  it("treats JS globals as undefined, never as values", () => {
    expect(evalFormula("globalThis")).toBeUndefined();
    expect(evalFormula("window")).toBeUndefined();
    expect(evalFormula("process")).toBeUndefined();
    expect(evalFormula("Function")).toBeUndefined();
  });

  it("rejects assignment, computed member, and template syntax at the lexer", () => {
    mustThrow("a = 1");
    mustThrow('habits["constructor"]', HABITS);
    mustThrow("habits[0]", HABITS);
    mustThrow("`x`");
    mustThrow("a; b");
    mustThrow("a && b"); // use the word `and`, not the JS operator
  });

  it("there is no way to MUTATE state from a formula (read-only by construction)", () => {
    // no assignment node exists, so prototype pollution / state mutation cannot be expressed
    mustThrow("habits.__proto__.polluted = 1", HABITS);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("bounds nesting, length, and collection size (no hang)", () => {
    mustThrow("(".repeat(60) + "1" + ")".repeat(60)); // exceeds MAX_DEPTH
    mustThrow("1 + ".repeat(2000) + "1"); // exceeds MAX_LEN
    const big = { rows: Array.from({ length: 100_001 }, () => ({ done: true })) };
    mustThrow("count(rows where done)", big); // exceeds MAX_ITEMS
  });
});
