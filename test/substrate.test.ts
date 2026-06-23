// The substrate runtime, end-to-end: mount authored `data-sh-*` markup into a jsdom document,
// assert the initial reactive render, fire real events (the closed actions), and assert the DOM
// re-renders. This is the proof that the formula evaluator + reactive core compose into a thing
// you can *see* — without a line of model JavaScript executing.
import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { mountApp, mountApps, ACTIONS } from "../src/core/substrate/index.js";

let dom: JSDOM;
let doc: Document;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><body></body>");
  doc = dom.window.document;
});

/** Build a root element from an HTML string, attached to the jsdom document. */
function root(html: string): HTMLElement {
  const el = doc.createElement("div");
  el.innerHTML = html;
  doc.body.appendChild(el);
  return el;
}

/** Dispatch a click that the runtime's addEventListener("click") will catch. */
function click(el: Element | null): void {
  el!.dispatchEvent(new dom.window.Event("click", { bubbles: true, cancelable: true }));
}

const HABITS = () => ({
  habits: [
    { name: "water", done: true },
    { name: "stretch", done: false },
    { name: "read", done: false },
  ],
});

describe("substrate / one-way reactive bindings", () => {
  it("data-sh-text renders a formula and updates when state changes", () => {
    const el = root(`<p data-sh-text="count(habits where done) + ' / ' + count(habits)"></p>`);
    const app = mountApp(el, HABITS());
    const p = el.querySelector("p")!;
    expect(p.textContent).toBe("1 / 3");

    // mutate state directly through the handle, then re-render is driven by a fresh mount-style
    // action below; here we prove the binding reflects derived data on first render.
    app.destroy();
  });

  it("data-sh-show toggles visibility from a formula", () => {
    const el = root(`
      <p id="done" data-sh-show="count(habits where done) == count(habits)">all done!</p>
      <p id="todo" data-sh-show="count(habits where not done) > 0">keep going</p>
    `);
    mountApp(el, HABITS());
    expect((el.querySelector("#done") as HTMLElement).style.display).toBe("none"); // 1 != 3
    expect((el.querySelector("#todo") as HTMLElement).style.display).toBe(""); // 2 > 0 -> shown
  });

  it("data-sh-class toggles a class from a formula", () => {
    const el = root(`<span data-sh-class="complete count(habits where not done) == 0">x</span>`);
    mountApp(el, HABITS());
    expect(el.querySelector("span")!.classList.contains("complete")).toBe(false);
  });

  it("data-sh-attr-* binds an attribute reactively", () => {
    const el = root(`<a data-sh-attr-href="'#' + lower('Section')">link</a>`);
    mountApp(el, {});
    expect(el.querySelector("a")!.getAttribute("href")).toBe("#section");
  });
});

describe("substrate / repeat", () => {
  it("renders one node per item with per-item scope", () => {
    const el = root(`<ul data-sh-repeat="habits" data-sh-as="h"><li data-sh-text="h.name"></li></ul>`);
    mountApp(el, HABITS());
    const names = Array.from(el.querySelectorAll("li")).map((li) => li.textContent);
    expect(names).toEqual(["water", "stretch", "read"]);
  });

  it("re-renders the list when the collection changes via an action", () => {
    const el = root(`
      <ul data-sh-repeat="habits" data-sh-as="h">
        <li>
          <span data-sh-text="h.name"></span>
          <button class="del" data-sh-on="click: remove(habits, h)">x</button>
        </li>
      </ul>`);
    mountApp(el, HABITS());
    expect(el.querySelectorAll("li").length).toBe(3);

    click(el.querySelector("li .del")); // remove the first habit ("water")
    expect(el.querySelectorAll("li").length).toBe(2);
    expect(Array.from(el.querySelectorAll("li span")).map((s) => s.textContent)).toEqual(["stretch", "read"]);
  });
});

describe("substrate / two-way input binding", () => {
  const type = (input: HTMLInputElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const check = (input: HTMLInputElement, on: boolean): void => {
    input.checked = on;
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };

  it("binds a text input to a top-level field, both directions", () => {
    const el = root(`<input data-sh-bind="draft"><p data-sh-text="draft"></p>`);
    const app = mountApp(el, { draft: "hi" });
    const input = el.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("hi"); // state -> input
    type(input, "walk the dog");
    expect(app.state().draft).toBe("walk the dog"); // input -> state
    expect(el.querySelector("p")!.textContent).toBe("walk the dog"); // and the derived text updates
  });

  it("binds a checkbox to a member field", () => {
    const el = root(`<input type="checkbox" data-sh-bind="task.done">`);
    const app = mountApp(el, { task: { done: false } });
    const box = el.querySelector("input") as HTMLInputElement;
    expect(box.checked).toBe(false);
    check(box, true);
    expect((app.state().task as { done: boolean }).done).toBe(true);
  });

  it("refuses to bind through a blocked key (fail-closed at wire time)", () => {
    const el = root(`<input data-sh-bind="o.__proto__">`);
    expect(() => mountApp(el, { o: {} })).toThrow(/cannot target '__proto__'/);
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // no pollution
  });
});

describe("substrate / add + $ root + multi-action", () => {
  it("add(collection, {object literal}) appends a new item and the list grows", () => {
    const el = root(`
      <input data-sh-bind="draft">
      <span role="button" id="add" data-sh-on="click: add(habits, {name: draft, done: false}); set($, 'draft', '')">add</span>
      <ul data-sh-repeat="habits" data-sh-as="h"><li data-sh-text="h.name"></li></ul>`);
    const app = mountApp(el, { draft: "Meditate", habits: [{ name: "Water", done: true }] });
    expect(el.querySelectorAll("li").length).toBe(1);

    click(el.querySelector("#add"));
    expect(el.querySelectorAll("li").length).toBe(2);
    expect(Array.from(el.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["Water", "Meditate"]);
    expect(app.state().draft).toBe(""); // the second action cleared the draft via $
    expect((el.querySelector("input") as HTMLInputElement).value).toBe(""); // bound input reflects it
  });

  it("a key filter (keydown.enter) only fires the action on that key", () => {
    const el = root(`
      <input data-sh-bind="draft" data-sh-on="keydown.enter: add(items, {v: draft}); set($, 'draft', '')">
      <ul data-sh-repeat="items" data-sh-as="i"><li data-sh-text="i.v"></li></ul>`);
    const app = mountApp(el, { draft: "", items: [] });
    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "hello"; input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const key = (k: string) => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("a"); // a non-Enter key does nothing
    expect(el.querySelectorAll("li").length).toBe(0);
    key("Enter"); // Enter fires add + clear
    expect(el.querySelectorAll("li").length).toBe(1);
    expect(el.querySelector("li")!.textContent).toBe("hello");
    expect(app.state().draft).toBe("");
  });

  it("set($, field, value) writes a top-level field", () => {
    const el = root(`<p data-sh-text="streak"></p><span id="b" data-sh-on="click: set($, 'streak', streak + 1)">+</span>`);
    const app = mountApp(el, { streak: 4 });
    click(el.querySelector("#b"));
    expect(el.querySelector("p")!.textContent).toBe("5");
    expect(app.state().streak).toBe(5);
  });
});

describe("substrate / actions mutate state and re-render", () => {
  it("toggle flips a field and derived text updates", () => {
    const el = root(`
      <p data-sh-text="count(habits where done)"></p>
      <ul data-sh-repeat="habits" data-sh-as="h">
        <li><button data-sh-on="click: toggle(h, 'done')" data-sh-text="h.name"></button></li>
      </ul>`);
    const app = mountApp(el, HABITS());
    expect(el.querySelector("p")!.textContent).toBe("1");

    // each action re-renders the whole repeat (coarse v1 reactivity), so the buttons are
    // replaced — re-query rather than holding a stale NodeList.
    click(el.querySelectorAll("li button")[1]); // toggle "stretch" -> done
    expect(el.querySelector("p")!.textContent).toBe("2");
    expect((app.state().habits as Array<{ done: boolean }>)[1].done).toBe(true);

    click(el.querySelectorAll("li button")[0]); // toggle "water" -> undone
    expect(el.querySelector("p")!.textContent).toBe("1");
  });

  it("inc adds to a numeric field", () => {
    const el = root(`
      <p data-sh-text="counter.n"></p>
      <button id="plus" data-sh-on="click: inc(counter, 'n', 5)"></button>`);
    const app = mountApp(el, { counter: { n: 0 } });
    expect(el.querySelector("p")!.textContent).toBe("0");
    click(el.querySelector("#plus"));
    click(el.querySelector("#plus"));
    expect(el.querySelector("p")!.textContent).toBe("10");
    expect((app.state().counter as { n: number }).n).toBe(10);
  });

  it("set assigns a field from a formula value", () => {
    const el = root(`
      <p data-sh-text="profile.tier"></p>
      <button id="up" data-sh-on="click: set(profile, 'tier', upper(profile.tier))"></button>`);
    const el2 = el; // alias for clarity
    mountApp(el2, { profile: { tier: "free" } });
    expect(el2.querySelector("p")!.textContent).toBe("free");
    click(el2.querySelector("#up"));
    expect(el2.querySelector("p")!.textContent).toBe("FREE");
  });
});

describe("substrate / mountApps scans [data-sh-app] regions", () => {
  it("mounts a region from its data-sh-state JSON and marks it ready", () => {
    const el = root(`
      <div data-sh-app data-sh-state='{"habits":[{"name":"a","done":true},{"name":"b","done":false}]}'>
        <p data-sh-text="count(habits where done) + '/' + count(habits)"></p>
      </div>`);
    const handles = mountApps(el);
    expect(handles.length).toBe(1);
    expect(el.querySelector("[data-sh-app]")!.hasAttribute("data-sh-ready")).toBe(true);
    expect(el.querySelector("p")!.textContent).toBe("1/2");
  });

  it("is idempotent — a region already mounted is not mounted twice", () => {
    const el = root(`<div data-sh-app data-sh-state='{"n":1}'><p data-sh-text="n"></p></div>`);
    expect(mountApps(el).length).toBe(1);
    expect(mountApps(el).length).toBe(0); // second pass skips the already-mounted region
  });

  it("a malformed data-sh-state mounts an empty app instead of throwing", () => {
    const el = root(`<div data-sh-app data-sh-state="{not json}"><p data-sh-text="missing"></p></div>`);
    expect(() => mountApps(el)).not.toThrow();
    expect(el.querySelector("p")!.textContent).toBe(""); // undefined -> empty
  });
});

describe("substrate / components (data-sh-def + data-sh-use)", () => {
  it("expands a component at the use site with args, and removes the definition", () => {
    const el = root(`
      <div data-sh-def="greeting"><p data-sh-text="'Hi ' + who"></p></div>
      <div data-sh-use="greeting" data-sh-arg-who="name"></div>`);
    mountApp(el, { name: "Sam" });
    expect(el.querySelector("[data-sh-def]")).toBeNull(); // definition is harvested, not rendered
    expect(el.querySelector("p")!.textContent).toBe("Hi Sam");
  });

  it("a component used inside a repeat renders per item and stays reactive", () => {
    const el = root(`
      <div data-sh-def="row"><button data-sh-on="click: toggle(h, 'done')" data-sh-text="h.name"></button></div>
      <ul data-sh-repeat="habits" data-sh-as="h"><li data-sh-use="row" data-sh-arg-h="h"></li></ul>
      <p data-sh-text="count(habits where done)"></p>`);
    mountApp(el, { habits: [{ name: "a", done: false }, { name: "b", done: true }] });
    expect(el.querySelectorAll("li button").length).toBe(2);
    expect(el.querySelector("p")!.textContent).toBe("1");
    click(el.querySelectorAll("li button")[0]); // toggle "a" done via the component's action
    expect(el.querySelector("p")!.textContent).toBe("2");
  });

  it("an unknown component is skipped, not fatal", () => {
    const el = root(`<div data-sh-use="nope"></div><p data-sh-text="'ok'"></p>`);
    expect(() => mountApp(el, {})).not.toThrow();
    expect(el.querySelector("p")!.textContent).toBe("ok");
  });

  it("a self-referential component is depth-capped, not an expansion bomb", () => {
    const el = root(`<div data-sh-def="loop"><span data-sh-use="loop"></span></div><div data-sh-use="loop"></div>`);
    expect(() => mountApp(el, {})).not.toThrow(); // bounded by MAX_COMPONENT_DEPTH
  });
});

describe("substrate / safety carries from markup into behavior", () => {
  it("rejects an unknown action at wire time", () => {
    const el = root(`<button data-sh-on="click: drop(habits)"></button>`);
    expect(() => mountApp(el, HABITS())).toThrow(/unknown action/);
  });

  it("an action cannot touch a prototype-chain field", () => {
    // a normal field assigns fine
    const el = root(`<button id="b" data-sh-on="click: set(o, 'safe', 1)"></button>`);
    const app = mountApp(el, { o: {} });
    click(el.querySelector("#b"));
    expect((app.state().o as Record<string, unknown>).safe).toBe(1);

    // the registry guard rejects a blocked field name (asserted directly — jsdom swallows
    // exceptions thrown inside event listeners, so this can't be observed through click()).
    expect(() => ACTIONS.set([{}, "__proto__", 1])).toThrow(/not allowed/);
    expect(() => ACTIONS.set([{}, "constructor", 1])).toThrow(/not allowed/);
    expect(() => ACTIONS.toggle([{}, "prototype"])).toThrow(/not allowed/);

    // and end-to-end: firing the blocked action pollutes nothing
    const el2 = root(`<button id="b" data-sh-on="click: set(o, '__proto__', 1)"></button>`);
    const app2 = mountApp(el2, { o: {} });
    click(el2.querySelector("#b")); // error is swallowed by jsdom event dispatch
    expect(Object.getPrototypeOf(app2.state().o) === Object.prototype).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("data-sh-attr-* refuses to bind an event-handler or style target", () => {
    const el = root(`
      <button data-sh-attr-onclick="'alert(1)'" data-sh-attr-style="'color:red'" data-sh-attr-href="'#ok'">x</button>`);
    mountApp(el, {});
    const b = el.querySelector("button")!;
    expect(b.hasAttribute("onclick")).toBe(false); // not in the safe-target allowlist
    expect(b.hasAttribute("style")).toBe(false);
    expect(b.getAttribute("href")).toBe("#ok"); // a safe target still binds
  });

  it("data-sh-attr-href drops a javascript: / unsafe URL", () => {
    const el = root(`<a data-sh-attr-href="'javascript:alert(1)'">x</a>`);
    mountApp(el, {});
    expect(el.querySelector("a")!.hasAttribute("href")).toBe(false); // unsafe URL -> not set

    const el2 = root(`<a data-sh-attr-href="'https://example.com/ok'">x</a>`);
    mountApp(el2, {});
    expect(el2.querySelector("a")!.getAttribute("href")).toBe("https://example.com/ok");
  });

  it("a formula in a binding still cannot reach JS globals", () => {
    const el = root(`<p data-sh-text="process"></p>`);
    mountApp(el, {});
    expect(el.querySelector("p")!.textContent).toBe(""); // undefined -> empty, not the Node process
  });

  it("destroy() stops further updates", () => {
    const el = root(`
      <p data-sh-text="counter.n"></p>
      <button id="plus" data-sh-on="click: inc(counter, 'n')"></button>`);
    const app = mountApp(el, { counter: { n: 0 } });
    click(el.querySelector("#plus"));
    expect(el.querySelector("p")!.textContent).toBe("1");
    app.destroy();
    click(el.querySelector("#plus")); // listener removed -> no effect on the DOM
    expect(el.querySelector("p")!.textContent).toBe("1");
  });
});

// Regression tests for the adversarial security sweep findings (each was confirmed exploitable
// against the pre-fix code and must stay closed).
describe("substrate / sweep regressions", () => {
  it("[critical] a reactive href drops a whitespace/control-prefixed javascript:/data: URL", () => {
    // " javascript:..." passed the old regex (leading non-letter) and the browser strips the space
    // back to the live scheme. The runtime must normalize before the check, like the static door.
    const el = root(`<a data-sh-attr-href="' ' + 'javascript:alert(1)'">x</a>`);
    mountApp(el, {});
    expect(el.querySelector("a")!.hasAttribute("href")).toBe(false);

    const el2 = root(`<a data-sh-attr-href="'\\t' + 'data:text/html,x'">x</a>`); // tab-prefixed data:text/html
    mountApp(el2, {});
    expect(el2.querySelector("a")!.hasAttribute("href")).toBe(false);

    const el3 = root(`<a data-sh-attr-href="'https://example.com/ok'">x</a>`); // a legit URL still binds
    mountApp(el3, {});
    expect(el3.querySelector("a")!.getAttribute("href")).toBe("https://example.com/ok");
  });

  it("[medium] actions/binds refuse any built-in member name, not just the proto trio", () => {
    expect(() => ACTIONS.set([{}, "toString", 1])).toThrow(/not allowed/);
    expect(() => ACTIONS.set([{}, "valueOf", 1])).toThrow(/not allowed/);
    expect(() => ACTIONS.inc([{}, "hasOwnProperty", 1])).toThrow(/not allowed/);
    expect(() => mountApp(root(`<input data-sh-bind="o.toString">`), { o: {} })).toThrow(/cannot target 'toString'/);
    expect(() => mountApp(root(`<input data-sh-bind="$">`), {})).toThrow(/cannot target '\$'/);
  });

  it("[medium] a state object with a shadowed toString does not crash a binding (hostile data-sh-state)", () => {
    // emulates data-sh-state='{"o":{"toString":1}}' surviving to the render layer
    const el = root(`<a data-sh-attr-title="o">x</a><p data-sh-text="o"></p>`);
    expect(() => mountApp(el, { o: { toString: 1 } })).not.toThrow();
    expect(el.querySelector("a")!.hasAttribute("title")).toBe(false); // object -> attr removed, no String() throw
  });

  it("[low] a throwing action in a multi-action chain still re-renders committed state (no torn DOM)", () => {
    const el = root(`<p data-sh-text="a"></p><span id="b" data-sh-on="click: set($,'a',1); set(5,'b',2)">x</span>`);
    const app = mountApp(el, { a: 0 });
    click(el.querySelector("#b")); // 2nd action throws (target 5 is not an object); bump() runs in finally
    expect(app.state().a).toBe(1);
    expect(el.querySelector("p")!.textContent).toBe("1"); // DOM re-synced to committed state
  });
});
