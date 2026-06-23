// The substrate runtime: it turns authored markup (a closed set of `data-sh-*` directives)
// into a live, reactive view. The model writes HTML + formulas; this file is what binds them
// to the reactive core and the sandboxed evaluator. No model JavaScript ever runs — directives
// are the only surface, formulas are read-only, and the single way state changes is the closed
// ACTIONS registry. That is the whole safety story carried from markup into behavior.
//
// Directives (all values are formulas unless noted):
//   data-sh-text="<formula>"               reactive textContent
//   data-sh-show="<formula>"               reactive visibility (display:none when falsy)
//   data-sh-class="<name> <formula>"       toggle a class while the formula is truthy
//   data-sh-attr-<name>="<formula>"        reactive attribute (null/false removes it)
//   data-sh-repeat="<formula>"             render this element's inner template once per item
//     + data-sh-as="<alias>"               name the per-item binding in scope (default "item")
//   data-sh-on="<event>: <action(...)>"    run a closed action on an event, then re-render
//
// Reactivity is intentionally coarse: every binding subscribes to the one state signal, so any
// mutation re-runs all bindings. Correct and small; fine-grained per-field tracking — where the
// reactive core's dynamic dependencies would actually pay off — is a deliberate later step.

import { signal, effect } from "../reactive/signal.js";
import { compileFormula, type Scope } from "../formula/index.js";
import { parse } from "../formula/parse.js";
import { evaluate } from "../formula/evaluate.js";
import { ACTIONS } from "./actions.js";

export interface AppHandle {
  /** The live application state object (mutated in place by actions). */
  state: () => Record<string, unknown>;
  /** Tear down every binding and event listener wired by this mount. */
  destroy: () => void;
}

type ScopeFn = () => Scope;
type Sink = Array<() => void>;

const toText = (v: unknown): string =>
  v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? "" : String(v);

const truthy = (v: unknown): boolean =>
  v !== false && v != null && v !== 0 && v !== "" && !(Array.isArray(v) && v.length === 0);

const APP_MOUNTED = new WeakSet<Element>();

/**
 * Find every `[data-sh-app]` region under `root` and mount it. Initial state is read from the
 * element's `data-sh-state` attribute as JSON (pure data — parsed, never evaluated). Idempotent:
 * a region is mounted at most once, so re-running after an edit only picks up new regions.
 */
export function mountApps(root: ParentNode): AppHandle[] {
  const handles: AppHandle[] = [];
  root.querySelectorAll("[data-sh-app]").forEach((el) => {
    if (APP_MOUNTED.has(el)) return;
    let state: Record<string, unknown> = {};
    const raw = el.getAttribute("data-sh-state");
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          state = parsed as Record<string, unknown>;
        }
      } catch { /* a malformed state attribute mounts an empty app rather than throwing */ }
    }
    handles.push(mountApp(el, state));
    APP_MOUNTED.add(el);
    el.setAttribute("data-sh-ready", ""); // lets CSS reveal the region only after hydration
  });
  return handles;
}

export function mountApp(root: Element, initial: Record<string, unknown>): AppHandle {
  const doc = root.ownerDocument;
  const [getState, setState] = signal<Record<string, unknown>>(initial);
  // an action mutates nested references in place; bumping the top-level ref is what makes the
  // single state signal notify (Object.is on the same object would be a silent no-op).
  const bump = (): void => setState((s) => ({ ...s }));
  const rootScope: ScopeFn = () => getState();
  const disposers: Sink = [];

  walk(root, rootScope, disposers);

  return {
    state: () => getState(),
    destroy: () => { for (const d of disposers.splice(0)) d(); },
  };

  // ---- wiring ---------------------------------------------------------------

  function walk(el: Element, scope: ScopeFn, sink: Sink): void {
    // `repeat` owns its whole subtree (it clones a template per item), so we stop descending
    // here and let it re-wire children on each render.
    const repeatSrc = el.getAttribute("data-sh-repeat");
    if (repeatSrc !== null) { wireRepeat(el, repeatSrc, scope, sink); return; }
    wireElement(el, scope, sink);
    for (const child of Array.from(el.children)) walk(child, scope, sink);
  }

  function wireElement(el: Element, scope: ScopeFn, sink: Sink): void {
    const html = el as HTMLElement;

    const textSrc = el.getAttribute("data-sh-text");
    if (textSrc !== null) {
      const f = compileFormula(textSrc);
      sink.push(effect(() => { el.textContent = toText(f(scope())); }));
    }

    const showSrc = el.getAttribute("data-sh-show");
    if (showSrc !== null) {
      const f = compileFormula(showSrc);
      // remember the element's "shown" display so we can restore it instead of forcing "block"
      const shown = html.style.display === "none" ? "" : html.style.display;
      sink.push(effect(() => { html.style.display = truthy(f(scope())) ? shown : "none"; }));
    }

    const classSrc = el.getAttribute("data-sh-class");
    if (classSrc !== null) {
      const sp = classSrc.indexOf(" ");
      const className = (sp === -1 ? classSrc : classSrc.slice(0, sp)).trim();
      const f = compileFormula(sp === -1 ? "true" : classSrc.slice(sp + 1).trim());
      sink.push(effect(() => { el.classList.toggle(className, truthy(f(scope()))); }));
    }

    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith("data-sh-attr-")) continue;
      const target = attr.name.slice("data-sh-attr-".length);
      const f = compileFormula(attr.value);
      sink.push(effect(() => {
        const v = f(scope());
        if (v == null || v === false) el.removeAttribute(target);
        else el.setAttribute(target, v === true ? "" : String(v));
      }));
    }

    const onSrc = el.getAttribute("data-sh-on");
    if (onSrc !== null) wireAction(el, onSrc, scope, sink);
  }

  function wireRepeat(el: Element, src: string, parentScope: ScopeFn, sink: Sink): void {
    const alias = el.getAttribute("data-sh-as") || "item";
    const template = el.innerHTML;
    el.textContent = "";
    const f = compileFormula(src);
    const tpl = doc.createElement("template");
    let childDisposers: Sink = [];

    const owner = effect(() => {
      // tear down the previous render's bindings first. Because `owner` subscribed to state
      // before these children did, it runs first in the flush wave; the reactive core then
      // skips the now-disposed child effects instead of letting them fire on dead nodes.
      for (const d of childDisposers.splice(0)) d();
      const coll = f(parentScope());
      const items = Array.isArray(coll) ? coll : [];
      el.textContent = "";
      for (const item of items) {
        tpl.innerHTML = template;
        const frag = tpl.content.cloneNode(true) as DocumentFragment;
        const itemScope: ScopeFn = () => ({ ...parentScope(), [alias]: item });
        for (const child of Array.from(frag.children)) walk(child, itemScope, childDisposers);
        el.appendChild(frag);
      }
    });

    sink.push(owner, () => { for (const d of childDisposers.splice(0)) d(); });
  }

  function wireAction(el: Element, spec: string, scope: ScopeFn, sink: Sink): void {
    const colon = spec.indexOf(":");
    if (colon === -1) throw new Error(`data-sh-on must be "<event>: <action(...)>", got: ${spec}`);
    const event = spec.slice(0, colon).trim();
    const ast = parse(spec.slice(colon + 1).trim());
    if (ast.t !== "call") throw new Error(`data-sh-on action must be a function call, got: ${spec}`);
    const action = ACTIONS[ast.name];
    if (!action) throw new Error(`data-sh-on: unknown action '${ast.name}'`);
    const argNodes = ast.args;

    const handler = (ev: Event): void => {
      ev.preventDefault();
      // evaluate each argument against the *current* scope — idents/members resolve to the live
      // references in state, which is exactly what an action mutates.
      action(argNodes.map((node) => evaluate(node, scope())));
      bump();
    };
    el.addEventListener(event, handler);
    sink.push(() => el.removeEventListener(event, handler));
  }
}
