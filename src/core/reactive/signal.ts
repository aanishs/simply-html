// A minimal push-pull reactive core: signals, derived computeds, and effects, with automatic
// dependency tracking. This is the engine the substrate binds UI to — change a signal, and
// every computed/effect that read it re-runs, nothing else does.
//
// How dependency tracking works:
//   - A running effect/computed is the `currentObserver`. While it runs, every signal it READS
//     subscribes it (bidirectional link: the signal remembers the observer, the observer
//     remembers the signal's subscriber-set).
//   - Writing a signal schedules its subscribers to re-run.
//   - Before each re-run, the observer CLEANS UP its old links, so dependencies that weren't
//     read this time (e.g. behind a now-false branch) stop firing it. Dynamic deps "just work".
//   - A batch + a drain loop dedupe re-runs: computeds (direct subscribers) recompute in the
//     first wave and schedule their own subscribers into the next, so layered graphs settle
//     without a downstream effect seeing a half-updated graph.

type Subscriber = Set<Computation>;

interface Computation {
  run: () => void;
  deps: Set<Subscriber>; // the subscriber-sets this computation is currently in
}

let currentObserver: Computation | null = null;
let batchDepth = 0;
let flushing = false;
const pending = new Set<Computation>();

function track(subs: Subscriber): void {
  if (currentObserver) {
    subs.add(currentObserver);
    currentObserver.deps.add(subs);
  }
}

function cleanup(c: Computation): void {
  for (const subs of c.deps) subs.delete(c);
  c.deps.clear();
}

function schedule(c: Computation): void {
  pending.add(c);
  if (batchDepth === 0 && !flushing) flush();
}

function flush(): void {
  if (flushing) return; // a write during a flush just enqueues; the drain loop picks it up
  flushing = true;
  try {
    // drain in waves; computeds scheduled during a wave run in the next, so a graph settles
    let guard = 0;
    while (pending.size) {
      if (++guard > 1_000_000) throw new Error("reactive update did not settle (cycle?)");
      const wave = [...pending];
      pending.clear();
      for (const c of wave) c.run();
    }
  } finally {
    flushing = false;
  }
}

/** Group writes so dependent effects run once after all of them, not once per write. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try { return fn(); } finally { batchDepth--; if (batchDepth === 0) flush(); }
}

export type Signal<T> = readonly [get: () => T, set: (next: T | ((prev: T) => T)) => void];

/** A writable reactive value. Reading inside an effect/computed subscribes to it. */
export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs: Subscriber = new Set();
  const get = (): T => { track(subs); return value; };
  const set = (next: T | ((prev: T) => T)): void => {
    const v = typeof next === "function" ? (next as (p: T) => T)(value) : next;
    if (Object.is(v, value)) return; // no-op writes don't notify
    value = v;
    // batch so ALL of this write's subscribers are scheduled before the graph drains;
    // otherwise a diamond (a -> b, a -> c, b+c -> d) would run d on a half-updated graph.
    batch(() => { for (const c of [...subs]) schedule(c); });
  };
  return [get, set] as const;
}

/** Run `fn` now, re-run it whenever any signal it read changes. Returns a disposer. */
export function effect(fn: () => void): () => void {
  const c: Computation = {
    deps: new Set(),
    run: () => {
      cleanup(c);
      const prev = currentObserver;
      currentObserver = c;
      try { fn(); } finally { currentObserver = prev; }
    },
  };
  c.run();
  return () => cleanup(c);
}

/** A memoized derived value. Recomputes when its inputs change; reads subscribe like a signal. */
export function computed<T>(fn: () => T): () => T {
  const [get, set] = signal<T>(undefined as T);
  effect(() => set(fn()));
  return get;
}
