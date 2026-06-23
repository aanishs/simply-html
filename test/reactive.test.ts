import { describe, it, expect } from "vitest";
import { signal, computed, effect, batch } from "../src/core/reactive/signal.js";

describe("reactive / signals", () => {
  it("reads and writes", () => {
    const [get, set] = signal(1);
    expect(get()).toBe(1);
    set(2);
    expect(get()).toBe(2);
    set((p) => p + 10);
    expect(get()).toBe(12);
  });

  it("an effect runs immediately and on every change", () => {
    const [get, set] = signal(0);
    let runs = 0;
    let seen = -1;
    effect(() => { runs++; seen = get(); });
    expect(runs).toBe(1);
    expect(seen).toBe(0);
    set(5);
    expect(runs).toBe(2);
    expect(seen).toBe(5);
  });

  it("a no-op write (Object.is equal) does not re-run effects", () => {
    const [get, set] = signal(5);
    let runs = 0;
    effect(() => { runs++; get(); });
    set(5);
    expect(runs).toBe(1);
  });

  it("computed memoizes and updates", () => {
    const [get, set] = signal(2);
    let computeRuns = 0;
    const dbl = computed(() => { computeRuns++; return get() * 2; });
    expect(dbl()).toBe(4);
    expect(dbl()).toBe(4); // memoized, no recompute on read
    expect(computeRuns).toBe(1);
    set(3);
    expect(dbl()).toBe(6);
    expect(computeRuns).toBe(2);
  });

  it("dynamic dependencies: an unread signal stops firing the effect", () => {
    const [show, setShow] = signal(true);
    const [x, setX] = signal(10);
    let runs = 0;
    let seen = 0;
    effect(() => { runs++; seen = show() ? x() : -1; });
    expect([runs, seen]).toEqual([1, 10]);
    setX(20);
    expect([runs, seen]).toEqual([2, 20]);
    setShow(false); // effect no longer reads x
    expect([runs, seen]).toEqual([3, -1]);
    setX(30); // x changed, but the effect dropped its dependency on x
    expect([runs, seen]).toEqual([3, -1]);
  });

  it("diamond graph settles glitch-free (downstream runs once, with final values)", () => {
    const [a, setA] = signal(1);
    const b = computed(() => a() * 2);
    const c = computed(() => a() + 1);
    let dRuns = 0;
    let dVal = 0;
    effect(() => { dRuns++; dVal = b() + c(); });
    expect([dRuns, dVal]).toEqual([1, 4]); // 1*2 + (1+1)
    setA(2);
    expect(dVal).toBe(7); // 2*2 + (2+1)
    expect(dRuns).toBe(2); // initial + exactly one settled re-run, not two
  });

  it("batch coalesces multiple writes into one effect run", () => {
    const [a, setA] = signal(0);
    const [b, setB] = signal(0);
    let runs = 0;
    let sum = 0;
    effect(() => { runs++; sum = a() + b(); });
    batch(() => { setA(1); setB(2); });
    expect(runs).toBe(2); // initial + one batched run
    expect(sum).toBe(3);
  });

  it("an effect disposed earlier in the same flush wave does not re-run (the repeat teardown case)", () => {
    // models `repeat`: an owner effect rebuilds children on every change; the OLD child
    // effects, subscribed to the same signal, must not fire on the about-to-be-replaced DOM.
    const [get, set] = signal(0);
    let childRuns = 0;
    let disposeChild = () => {};
    // owner runs first (subscribes first), disposes the previous child, makes a new one
    effect(() => {
      get(); // owner depends on the signal
      disposeChild();
      disposeChild = effect(() => { childRuns++; get(); });
    });
    expect(childRuns).toBe(1); // one child built
    set(1); // owner + old child both scheduled; owner runs first, disposes old child
    expect(childRuns).toBe(2); // exactly the rebuilt child ran — the disposed one did NOT
    set(2);
    expect(childRuns).toBe(3); // still one child run per change, no leak accumulation
  });

  it("dispose stops an effect", () => {
    const [get, set] = signal(0);
    let runs = 0;
    const dispose = effect(() => { runs++; get(); });
    set(1);
    expect(runs).toBe(2);
    dispose();
    set(2);
    expect(runs).toBe(2);
    expect(get()).toBe(2);
  });
});
