// `simply-html brand` — derive and persist a minimalist brand: one accent, one logo, an
// optional font. Deliberately restrained: it sets tokens the reading template applies
// sparingly (links, rules, buttons, a small header bar), never a full theme takeover.

import { existsSync } from "node:fs";
import type { BrandTokens } from "../../core/types.js";
import { loadBrand, writeBrand, embedLogo } from "../brand/load.js";
import { line, note, fail } from "../output.js";

export interface BrandOpts {
  name?: string;
  accent?: string;
  font?: string;
  density?: string;
  logo?: string;
  dir?: string;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function summarize(b: BrandTokens): void {
  line("name", b.name || "(none)");
  line("accent", b.accent || "(default coral)");
  line("font", b.font || "(default Inter)");
  line("density", b.density || "comfortable");
  line("logo", b.logo ? `embedded (${Math.round((b.logo.length * 0.75) / 1024)} KB)` : "(none)");
}

export async function brandCommand(action: string, opts: BrandOpts): Promise<void> {
  const dir = opts.dir || process.cwd();

  if (action === "show") {
    const b = loadBrand(dir);
    if (!b) {
      note("No brand set. Defaults apply (coral accent, Inter, minimalist).");
      note("Create one: `simply-html brand set --logo ./logo.png --accent \"#e0603a\" --name \"Acme\"`");
      return;
    }
    note("Resolved brand:");
    summarize(b);
    return;
  }

  if (action !== "set") {
    fail(`unknown brand action "${action}". Use: show | set`);
  }

  const tokens: BrandTokens = {};
  if (opts.name) tokens.name = opts.name;
  if (opts.font) tokens.font = opts.font;
  if (opts.density === "compact" || opts.density === "comfortable") tokens.density = opts.density;
  if (opts.accent) {
    if (!HEX.test(opts.accent)) fail(`--accent must be a hex color (e.g. #e0603a); got ${opts.accent}`);
    tokens.accent = opts.accent;
  }

  if (opts.logo) {
    if (!existsSync(opts.logo)) fail(`logo not found: ${opts.logo}`);
    let embedded;
    try {
      embedded = embedLogo(opts.logo);
    } catch (e) {
      fail((e as Error).message);
    }
    tokens.logo = embedded.dataUri;
    if (embedded.warnLarge) {
      note(`note: logo is ${Math.round(embedded.bytes / 1024)} KB — consider a smaller file so pages stay light.`);
    }
  }

  if (Object.keys(tokens).length === 0) {
    fail("nothing to set. Pass --name / --accent / --font / --density / --logo.");
  }

  const path = writeBrand(dir, tokens);
  note(`Brand saved to ${path}`);
  summarize(loadBrand(dir) || tokens);
  note("It will apply to every `simply-html preview` / `publish` from here — minimally, by design.");
}
