// Select-to-edit: select a region of the page, describe a change, and your CLI (via the
// preview bridge) rewrites those blocks in place. The model returns content only — sanitized
// server-side, never executed — so the "no model JavaScript" rule still holds. Local-only:
// the bridge's /__sh/edit endpoint runs the model and persists to the page source.
import { hydrateTree } from "./components.js";

const MAIN = ".k-main";

interface Region {
  readonly from: HTMLElement;
  readonly to: HTMLElement;
  readonly blocks: readonly HTMLElement[];
}

type EditResponse = { ok: true; text: string } | { ok: false; error?: { code?: string; message?: string } };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

class SelectToEdit {
  private region: Region | null = null;
  private pill: HTMLButtonElement | null = null;
  private pod: HTMLElement | null = null;

  start(): void {
    document.addEventListener("mouseup", () => this.onSelection());
    document.addEventListener("keydown", (e) => e.key === "Escape" && this.reset());
  }

  /** Walk up to the addressable top-level block inside the reading column. */
  private blockOf(node: Node | null): HTMLElement | null {
    const main = document.querySelector(MAIN);
    let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
    while (el && el.parentElement !== main) el = el.parentElement;
    return el?.parentElement === main && el.hasAttribute("data-sh-id") ? (el as HTMLElement) : null;
  }

  private onSelection(): void {
    if (this.pod) return; // a pod is open; ignore new selections until it closes
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return this.hidePill();
    const from = this.blockOf(sel.anchorNode);
    const to = this.blockOf(sel.focusNode);
    const main = document.querySelector(MAIN);
    if (!from || !to || !main) return this.hidePill();

    const all = [...main.children].filter((e): e is HTMLElement => e.hasAttribute("data-sh-id"));
    const i = all.indexOf(from);
    const j = all.indexOf(to);
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    this.region = { from: all[lo]!, to: all[hi]!, blocks: all.slice(lo, hi + 1) };
    this.showPill(sel.getRangeAt(0).getBoundingClientRect());
  }

  private showPill(at: DOMRect): void {
    this.pill ??= this.buildPill();
    this.pill.style.top = `${Math.max(8, at.top - 38)}px`;
    this.pill.style.left = `${at.right - 64}px`;
    this.pill.style.display = "block"; // explicit: the CSS resting state is display:none
  }
  private hidePill(): void {
    if (this.pill) this.pill.style.display = "none";
  }
  private buildPill(): HTMLButtonElement {
    const pill = el("button", "k-edit-pill", "✦ Edit");
    pill.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection alive
    pill.addEventListener("click", () => this.openPod());
    document.body.append(pill);
    return pill;
  }

  private openPod(): void {
    if (!this.region) return;
    this.hidePill();
    this.region.blocks.forEach((b) => b.classList.add("k-edit-target"));

    const pod = el("div", "k-edit-pod");
    const input = el("textarea");
    input.placeholder = "Describe the change… (e.g. make this a checklist)";
    input.rows = 2;
    const status = el("div", "k-edit-status");
    const cancel = el("button", "k-edit-btn ghost", "Cancel");
    const apply = el("button", "k-edit-btn", "Apply");
    const actions = el("div", "k-edit-actions");
    actions.append(status, cancel, apply);
    pod.append(input, actions);

    const rect = this.region.from.getBoundingClientRect();
    pod.style.top = `${Math.min(window.innerHeight - 160, rect.bottom + 8)}px`;
    pod.style.left = `${Math.max(12, Math.min(window.innerWidth - 372, rect.left))}px`;
    document.body.append(pod);
    this.pod = pod;
    input.focus();

    const run = (): void => void this.apply(input.value.trim(), { input, apply, cancel, status });
    cancel.addEventListener("click", () => this.reset());
    apply.addEventListener("click", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
    });
  }

  private async apply(
    instruction: string,
    ui: { input: HTMLTextAreaElement; apply: HTMLButtonElement; cancel: HTMLButtonElement; status: HTMLElement },
  ): Promise<void> {
    const region = this.region;
    const k = window.__SIMPLY_HTML__;
    if (!region || !k || !instruction) return;

    ui.input.disabled = ui.apply.disabled = ui.cancel.disabled = true;
    ui.status.textContent = "editing…";
    ui.status.className = "k-edit-status busy";

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (k.token) headers["authorization"] = `Bearer ${k.token}`;

    let data: EditResponse;
    try {
      const res = await fetch(`${k.base}/__sh/edit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: region.from.dataset["shId"],
          to: region.to.dataset["shId"],
          regionHtml: region.blocks.map((b) => b.outerHTML).join(""),
          instruction,
        }),
      });
      data = (await res.json()) as EditResponse;
    } catch {
      return this.fail(ui, "bridge offline — is `simply-html preview` running?");
    }

    if (!data.ok) return this.fail(ui, data.error?.message ?? "edit failed");
    this.replaceRegion(region, data.text);
    this.reset();
  }

  private replaceRegion(region: Region, replacement: string): void {
    const staging = el("div");
    staging.innerHTML = replacement;
    const parent = region.from.parentElement;
    if (!parent) return;
    while (staging.firstChild) parent.insertBefore(staging.firstChild, region.from);
    region.blocks.forEach((b) => b.remove());
    hydrateTree(parent); // hydrate any new components; the guard skips existing ones
  }

  private fail(ui: { apply: HTMLButtonElement; cancel: HTMLButtonElement; input: HTMLTextAreaElement; status: HTMLElement }, msg: string): void {
    ui.input.disabled = ui.apply.disabled = ui.cancel.disabled = false;
    ui.status.textContent = msg;
    ui.status.className = "k-edit-status error";
  }

  private reset(): void {
    this.pod?.remove();
    this.pod = null;
    this.region?.blocks.forEach((b) => b.classList.remove("k-edit-target"));
    this.region = null;
    this.hidePill();
    window.getSelection()?.removeAllRanges();
  }
}


export function initSelectToEdit(): void {
  // The bridge's /__sh/edit (model + sanitize + persist) exists only for local preview.
  if (window.__SIMPLY_HTML__?.mode !== "local") return;
  new SelectToEdit().start();
}
