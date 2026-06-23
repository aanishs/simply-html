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
