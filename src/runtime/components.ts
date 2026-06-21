// The closed component vocabulary. The model emits a container with `data-sh-component`
// plus `data-sh-*` hooks; the runtime owns 100% of the behavior. The model never writes
// JavaScript. `hydrateTree` is idempotent (a WeakSet guard) so editing a region re-hydrates
// only the new nodes.
import { store } from "./data.js";
import { askLLM } from "./llm.js";

type Hydrator = (el: HTMLElement) => void;

// --- tiny DOM helpers ---
const uid = (): string => Math.random().toString(36).slice(2, 9);
const attr = (el: Element, name: string): string | null => el.getAttribute(`data-sh-${name}`);
function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// --- todo / list ---
interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  order: number;
}

function seedItems(container: Element, withDone: boolean): ChecklistItem[] {
  return [...container.querySelectorAll("li")].map((li, order) => ({
    id: uid(),
    text: (li.textContent ?? "").trim(),
    done: withDone && !!li.querySelector<HTMLInputElement>('input[type="checkbox"]:checked'),
    order,
  }));
}

function hydrateChecklist(container: HTMLElement, withDone: boolean): void {
  const key = `${withDone ? "todo" : "list"}:${attr(container, "key") ?? "default"}`;
  const label = attr(container, "label");
  let items = store.get<ChecklistItem[]>(key, []);
  let seeded = false;
  if (items.length === 0) {
    items = seedItems(container, withDone);
    seeded = items.length > 0;
  }

  container.textContent = "";
  container.classList.add(withDone ? "sh-todo" : "sh-list");

  const render = (): void => {
    container.textContent = "";
    if (label) container.append(h("div", "k-comp-label", label));

    const ul = h("ul", "contains-task-list");
    for (const item of [...items].sort((a, b) => a.order - b.order)) {
      const li = h("li", "task-list-item");
      const text = h("span", undefined, item.text);
      if (withDone) {
        const box = h("input", "task-list-item-checkbox");
        box.type = "checkbox";
        box.checked = item.done;
        box.addEventListener("change", () => {
          item.done = box.checked;
          store.set(key, items);
          text.style.cssText = item.done ? "opacity:.55;text-decoration:line-through" : "";
        });
        li.append(box);
      }
      if (withDone && item.done) text.style.cssText = "opacity:.55;text-decoration:line-through";
      const remove = h("button", "k-x", "×");
      remove.title = "remove";
      remove.addEventListener("click", () => {
        items = items.filter((x) => x.id !== item.id);
        store.set(key, items);
        render();
      });
      li.append(text, remove);
      ul.append(li);
    }
    container.append(ul);

    const form = h("form", "k-add");
    const input = h("input");
    input.type = "text";
    input.placeholder = "Add…";
    form.append(input);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      items.push({ id: uid(), text: value, done: false, order: items.length });
      store.set(key, items);
      render();
    });
    container.append(form);
  };

  render();
  void store.pull<ChecklistItem[]>(key).then((server) => {
    if (Array.isArray(server)) {
      items = server;
      render();
    } else if (seeded) {
      store.set(key, items);
    }
  });
}

// --- counter ---
function hydrateCounter(container: HTMLElement): void {
  const key = `counter:${attr(container, "key") ?? "default"}`;
  const min = Number(attr(container, "min") ?? Number.NEGATIVE_INFINITY);
  const max = Number(attr(container, "max") ?? Number.POSITIVE_INFINITY);
  const step = Number(attr(container, "step") ?? 1);
  const label = attr(container, "label");
  let value = store.get<number>(key, Number(attr(container, "default") ?? 0));

  container.textContent = "";
  container.classList.add("sh-counter");
  const wrap = h("div", "k-counter");
  if (label) wrap.append(h("span", "k-comp-label", label));
  const out = h("span", "k-counter-val", String(value));
  const set = (next: number): void => {
    value = Math.max(min, Math.min(max, next));
    out.textContent = String(value);
    store.set(key, value);
  };
  const minus = h("button", undefined, "−");
  minus.addEventListener("click", () => set(value - step));
  const plus = h("button", undefined, "+");
  plus.addEventListener("click", () => set(value + step));
  wrap.append(minus, out, plus);
  container.append(wrap);

  void store.pull<number>(key).then((server) => {
    if (typeof server === "number") {
      value = server;
      out.textContent = String(value);
    }
  });
}

// --- tabs (the one nesting component) ---
function hydrateTabs(container: HTMLElement): void {
  const sections = [...container.querySelectorAll<HTMLElement>(":scope > section[data-sh-tab]")];
  if (sections.length === 0) return;
  let active = Math.max(0, sections.findIndex((s) => s.hasAttribute("data-sh-active")));

  const bar = h("div", "k-tabbar");
  const sync = (): void => {
    sections.forEach((s, i) => (s.style.display = i === active ? "" : "none"));
    [...bar.children].forEach((b, i) => b.classList.toggle("active", i === active));
  };
  sections.forEach((section, i) => {
    const tab = h("button", "k-tab", attr(section, "tab") ?? `Tab ${i + 1}`);
    tab.addEventListener("click", () => {
      active = i;
      sync();
    });
    bar.append(tab);
  });
  container.prepend(bar);
  sync();
}

// --- chat-pod ---
function hydrateChatPod(container: HTMLElement): void {
  const system = attr(container, "prompt") ?? undefined;
  container.textContent = "";
  container.classList.add("sh-chat-pod");
  container.append(h("div", "k-comp-label", attr(container, "label") ?? "Ask about this page"));
  const log = h("div", "k-chat-log");
  const form = h("form", "k-chat-form");
  const input = h("input");
  input.type = "text";
  input.placeholder = "Ask…";
  const send = h("button", "k-chat-send", "Ask");
  send.type = "submit";
  form.append(input, send);
  container.append(log, form);

  const bubble = (cls: string, text: string): HTMLElement => {
    const b = h("div", `k-bubble ${cls}`, text);
    log.append(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    bubble("user", question);
    const pending = bubble("assistant pending", "thinking…");
    input.disabled = send.disabled = true;
    const result = await askLLM(question, system ? { system } : {});
    input.disabled = send.disabled = false;
    input.focus();
    pending.classList.remove("pending");
    if (result.ok) {
      pending.textContent = result.text;
    } else {
      pending.classList.add("error");
      pending.textContent = result.message;
    }
  });
}
// --- registry + tree hydration ---
const REGISTRY: Readonly<Record<string, Hydrator>> = {
  todo: (el) => hydrateChecklist(el, true),
  list: (el) => hydrateChecklist(el, false),
  counter: hydrateCounter,
  tabs: hydrateTabs,
  callout: () => {}, // CSS-only
  "chat-pod": hydrateChatPod,
};

const hydrated = new WeakSet<Element>();

export function hydrateTree(root: ParentNode): void {
  const seenKeys = new Set<string>();
  root.querySelectorAll<HTMLElement>("[data-sh-component]").forEach((el) => {
    if (hydrated.has(el)) return;
    const type = el.dataset["shComponent"] ?? "";
    const key = el.dataset["shKey"];
    if (key) {
      const id = `${type}:${key}`;
      if (seenKeys.has(id)) return console.warn("[simply-html] duplicate component key:", id);
      seenKeys.add(id);
    }
    const hydrate = REGISTRY[type];
    try {
      if (hydrate) hydrate(el);
      else (el.classList.add("sh-note"), console.warn("[simply-html] unknown component:", type));
      hydrated.add(el);
    } catch (err) {
      console.warn("[simply-html] component failed:", type, err);
    }
  });
}
