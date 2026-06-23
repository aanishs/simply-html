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
//   data-sh-on="<event>: <action(...); ...>"  run closed action(s) on an event, then re-render
//   data-sh-bind="<field path>"            two-way bind an <input>/<textarea> to a state field
//
// The state root is also reachable as `$` in any formula/action (e.g. set($, 'draft', '')), so a
// top-level scalar field can be written without an enclosing object to name it.
//
// Reactivity is intentionally coarse: every binding subscribes to the one state signal, so any
// mutation re-runs all bindings. Correct and small; fine-grained per-field tracking — where the
// reactive core's dynamic dependencies would actually pay off — is a deliberate later step.

import { signal, effect } from "../reactive/signal.js";
import { compileFormula, isForbiddenKey, type Scope, type Node } from "../formula/index.js";
import { parse } from "../formula/parse.js";
import { evaluate } from "../formula/evaluate.js";
import {
  ALLOWED_URI_REGEXP, DATA_IMAGE_REGEX,
  SIMPLY_HTML_ATTR_BIND_TARGETS, SIMPLY_HTML_URL_BIND_TARGETS,
} from "../sanitize/config.js";
import { ACTIONS } from "./actions.js";

// The same whitespace/control set the sanitizer (DOMPurify) strips from a URL before scheme-matching.
const URL_WHITESPACE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;

// A reactive `href`/`src` is the one moment a javascript:/data:text URL could land — the sanitizer
// only saw the opaque data-sh-attr-* value. We MUST re-check exactly as the static door does:
// browsers strip leading/embedded control+whitespace before resolving a scheme, so " javascript:"
// or "java\tscript:" re-forms a dangerous scheme. Normalize first, then test — never diverge from
// DOMPurify, or the reactive door admits what the static door rejects.
const safeUrl = (v: string): boolean => {
  const normalized = v.replace(URL_WHITESPACE, "");
  return ALLOWED_URI_REGEXP.test(normalized) || DATA_IMAGE_REGEX.test(normalized);
};

// not assignable as a write target: prototype-chain/built-in members, plus `$` (the state root alias).
const isUnsafeWriteKey = (k: string): boolean => isForbiddenKey(k) || k === "$";

const MAX_COMPONENT_DEPTH = 32; // bounds component-use nesting so a self-referential component can't bomb
const warn = (msg: string): void => { if (typeof console !== "undefined") console.warn(`[simply-html] ${msg}`); };

/** Split on a top-level separator, ignoring it inside quotes or (), [], {}. */
function splitTopLevel(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quote) { if (c === quote && src[i - 1] !== "\\") quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === sep && depth === 0) { out.push(src.slice(start, i)); start = i + 1; }
  }
  out.push(src.slice(start));
  return out;
}

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
    APP_MOUNTED.add(el); // mark first: a region that throws is not retried on the next pass
    try {
      handles.push(mountApp(el, state));
      el.setAttribute("data-sh-ready", ""); // lets CSS reveal the region only after hydration
    } catch (err) {
      // one malformed region (e.g. an injected unknown action) must not abort the whole page
      if (typeof console !== "undefined") console.warn("[simply-html] app failed to mount:", err);
    }
  });
  return handles;
}

export function mountApp(root: Element, initial: Record<string, unknown>): AppHandle {
  const doc = root.ownerDocument;
  const [getState, setState] = signal<Record<string, unknown>>(initial);
  // an action mutates nested references in place; bumping the top-level ref is what makes the
  // single state signal notify (Object.is on the same object would be a silent no-op).
  const bump = (): void => setState((s) => ({ ...s }));
  // `$` names the live state root inside any formula/action, so a top-level field is writable
  // (set($, 'draft', '')) and readable ($.streak) without an enclosing object.
  const rootScope: ScopeFn = () => { const s = getState(); return { ...s, $: s }; };
  const disposers: Sink = [];

  // Components: the model defines a reusable fragment once with `data-sh-def="name"` and stamps it
  // with `data-sh-use="name"` (passing args via `data-sh-arg-<param>="<formula>"`). Definitions are
  // harvested here and removed from the DOM (they are templates, not content), then expanded at use
  // sites — at MOUNT time, composing the same audited primitives. No new model code, no eval.
  const components = new Map<string, string>();
  root.querySelectorAll("[data-sh-def]").forEach((el) => {
    const name = el.getAttribute("data-sh-def") || "";
    if (name) components.set(name, el.innerHTML);
    el.remove();
  });

  walk(root, rootScope, disposers, 0);

  return {
    state: () => getState(),
    destroy: () => { for (const d of disposers.splice(0)) d(); },
  };

  // ---- wiring ---------------------------------------------------------------

  function walk(el: Element, scope: ScopeFn, sink: Sink, depth: number): void {
    // a `data-sh-use` expands a component in place (owns its subtree like `repeat`).
    const useName = el.getAttribute("data-sh-use");
    if (useName !== null) { wireUse(el, useName, scope, sink, depth); return; }
    // `repeat` owns its whole subtree (it clones a template per item), so we stop descending
    // here and let it re-wire children on each render.
    const repeatSrc = el.getAttribute("data-sh-repeat");
    if (repeatSrc !== null) { wireRepeat(el, repeatSrc, scope, sink, depth); return; }
    wireElement(el, scope, sink);
    for (const child of Array.from(el.children)) walk(child, scope, sink, depth);
  }

  // Expand `data-sh-use="name"`: clone the named component's template into `el`, wiring it against
  // a scope extended with the args (`data-sh-arg-<param>="<formula>"`, re-evaluated reactively).
  function wireUse(el: Element, name: string, scope: ScopeFn, sink: Sink, depth: number): void {
    if (depth >= MAX_COMPONENT_DEPTH) { warn(`component '${name}' nested too deep`); return; }
    const template = components.get(name);
    if (template === undefined) { warn(`unknown component '${name}'`); return; }

    // each arg is a formula re-evaluated against the current scope, so the component stays reactive
    const argFns: Array<[string, (s?: Scope) => unknown]> = [];
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith("data-sh-arg-")) continue;
      argFns.push([attr.name.slice("data-sh-arg-".length), compileFormula(attr.value)]);
    }
    const childScope: ScopeFn = () => {
      const s: Scope = { ...scope() };
      for (const [param, f] of argFns) s[param] = f(scope());
      return s;
    };

    const tpl = doc.createElement("template");
    tpl.innerHTML = template;
    const frag = tpl.content.cloneNode(true) as DocumentFragment;
    el.textContent = "";
    for (const child of Array.from(frag.children)) walk(child, childScope, sink, depth + 1);
    el.appendChild(frag);
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
      const target = attr.name.slice("data-sh-attr-".length).toLowerCase();
      if (!SIMPLY_HTML_ATTR_BIND_TARGETS.has(target)) continue; // never bind on*/style/event attrs
      const isUrl = SIMPLY_HTML_URL_BIND_TARGETS.has(target);
      const f = compileFormula(attr.value);
      sink.push(effect(() => {
        const v = f(scope());
        // objects/arrays aren't sensible attribute values; treat them as "remove". This also makes
        // String() below crash-proof against a state object whose `toString` was shadowed (e.g. via
        // a hostile data-sh-state JSON) — a defense-in-depth backstop to the write-key guard.
        if (v == null || v === false || typeof v === "object") { el.removeAttribute(target); return; }
        const str = v === true ? "" : String(v);
        if (isUrl && str !== "" && !safeUrl(str)) { el.removeAttribute(target); return; }
        el.setAttribute(target, str);
      }));
    }

    const bindSrc = el.getAttribute("data-sh-bind");
    if (bindSrc !== null) wireBind(el, bindSrc, scope, sink);

    const onSrc = el.getAttribute("data-sh-on");
    if (onSrc !== null) wireAction(el, onSrc, scope, sink);
  }

  // Resolve an assignable target (the {object, key} a write lands on) from a field-path AST.
  // Only a bare ident (a top-level field on the root) or a `obj.key` member is assignable;
  // dangerous keys and non-object containers are refused. Returns null if not writable.
  function resolveTarget(path: Node, scope: Scope): { container: Record<string, unknown>; key: string } | null {
    if (path.t === "ident") {
      if (isUnsafeWriteKey(path.name)) return null;
      return { container: getState(), key: path.name }; // top-level fields live on the live root
    }
    if (path.t === "member") {
      if (isUnsafeWriteKey(path.key)) return null;
      const obj = evaluate(path.obj, scope);
      if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return null;
      return { container: obj as Record<string, unknown>, key: path.key };
    }
    return null;
  }

  function wireBind(el: Element, pathSrc: string, scope: ScopeFn, sink: Sink): void {
    const input = el as HTMLInputElement;
    const path = parse(pathSrc);
    if (path.t !== "ident" && path.t !== "member") {
      throw new Error(`data-sh-bind must be a field path (foo or foo.bar), got: ${pathSrc}`);
    }
    const terminalKey = path.t === "ident" ? path.name : path.key;
    if (isUnsafeWriteKey(terminalKey)) throw new Error(`data-sh-bind cannot target '${terminalKey}'`);
    const type = (input.getAttribute("type") || "").toLowerCase();
    const isCheckbox = input.tagName === "INPUT" && type === "checkbox";
    const isNumber = input.tagName === "INPUT" && type === "number";
    const read = compileFormula(pathSrc);

    // state -> input
    sink.push(effect(() => {
      const v = read(scope());
      if (isCheckbox) input.checked = truthy(v);
      else input.value = v == null ? "" : String(v);
    }));

    // input -> state
    const onInput = (): void => {
      const target = resolveTarget(path, scope());
      if (!target) return;
      target.container[target.key] = isCheckbox ? input.checked : isNumber ? Number(input.value) : input.value;
      bump();
    };
    const evt = isCheckbox ? "change" : "input";
    el.addEventListener(evt, onInput);
    sink.push(() => el.removeEventListener(evt, onInput));
  }

  function wireRepeat(el: Element, src: string, parentScope: ScopeFn, sink: Sink, depth: number): void {
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
        for (const child of Array.from(frag.children)) walk(child, itemScope, childDisposers, depth);
        el.appendChild(frag);
      }
    });

    sink.push(owner, () => { for (const d of childDisposers.splice(0)) d(); });
  }

  function wireAction(el: Element, spec: string, scope: ScopeFn, sink: Sink): void {
    // "<event>: call(...); call(...)" — the first ':' splits the event from the action list, and
    // ';' (at top level) separates multiple actions run in order on one event (e.g. add then clear).
    const colon = spec.indexOf(":");
    if (colon === -1) throw new Error(`data-sh-on must be "<event>: <action(...)>", got: ${spec}`);
    const event = spec.slice(0, colon).trim();
    const calls = splitTopLevel(spec.slice(colon + 1), ";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((src) => {
        const ast = parse(src);
        if (ast.t !== "call") throw new Error(`data-sh-on action must be a function call, got: ${src}`);
        if (!ACTIONS[ast.name]) throw new Error(`data-sh-on: unknown action '${ast.name}'`);
        return ast;
      });
    if (calls.length === 0) throw new Error(`data-sh-on has no action: ${spec}`);

    const handler = (ev: Event): void => {
      ev.preventDefault();
      // evaluate each argument against the *current* scope — idents/members resolve to the live
      // references in state, which is exactly what an action mutates. bump() runs in `finally` so a
      // throwing action (in a multi-action chain) still re-renders the DOM to committed state
      // instead of leaving a torn render.
      try {
        for (const ast of calls) ACTIONS[ast.name]!(ast.args.map((node) => evaluate(node, scope())));
      } finally {
        bump();
      }
    };
    el.addEventListener(event, handler);
    sink.push(() => el.removeEventListener(event, handler));
  }
}
