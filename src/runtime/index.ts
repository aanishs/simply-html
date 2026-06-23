// The simply-html browser runtime entry: ONE audited IIFE that owns 100% of interactivity. The
// model never authors JS; it emits content + the closed `data-sh-*` hooks hydrated here.
import { hydrateTree } from "./components.js";
import { store } from "./data.js";
import { initSelectToEdit } from "./edit.js";
import { mountApps } from "../core/substrate/index.js";

declare global {
  interface Window {
    __SIMPLY_HTML__?: { base: string; token?: string; mode: "local" | "deployed"; engine?: string };
  }
}

/** Markdown task-lists (`- [ ]`) that aren't explicit components: make their checkboxes persist. */
function wireMarkdownTaskLists(): void {
  document.querySelectorAll<HTMLElement>(".contains-task-list").forEach((list, li) => {
    if (list.closest("[data-sh-component]")) return;
    list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box, ci) => {
      const key = `tasklist:${li}:${ci}`;
      box.disabled = false;
      box.checked = store.get<boolean>(key, box.checked);
      box.addEventListener("change", () => store.set(key, box.checked));
    });
  });
}

function boot(): void {
  // Deployed pages carry no inline boot script (strict CSP), so default the config here.
  window.__SIMPLY_HTML__ ??= { base: location.origin, mode: "deployed" };
  hydrateTree(document);
  mountApps(document); // reactive [data-sh-app] regions: composed primitives + formulas
  wireMarkdownTaskLists();
  initSelectToEdit();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
