// `simply-html publish <file>` — deploy a page to a real URL behind a PIN gate using
// only a Vercel token. Renders the page, bakes it + the runtime into the one serverless
// function, links a Vercel project, sets secrets (over stdin, never argv), and deploys.

import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { render } from "../../core/render/markdown.js";
import { renderPage } from "../../core/render/template.js";
import { scan } from "../../core/scan.js";
import type { PageInput } from "../../core/types.js";
import { loadBrand } from "../brand/load.js";
import { generatePin, generateSalt, hashPin } from "../../function/pin.js";
import { loadVercelToken, resolveVercel, runVercel, parseDeployUrl, extractMissingScope, disableDeploymentProtection, readProjectIds } from "../deploy/vercel.js";
import { line, note, fail } from "../output.js";

export interface PublishOpts {
  db?: boolean;
  llm?: boolean;
  json?: boolean;
}

function distRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
}
function injectLiteral(src: string, token: string, value: string): string {
  const re = new RegExp(`(["'])${token}\\1`, "g");
  return src.replace(re, () => JSON.stringify(value));
}

export async function publishCommand(file: string, opts: PublishOpts): Promise<void> {
  if (!existsSync(file)) fail(`file not found: ${file}`);
  const token = loadVercelToken();
  if (!token) {
    fail(
      "no VERCEL_TOKEN found. Put it in a gitignored .env:\n" +
        "  printf 'VERCEL_TOKEN=...\\n' > .env && chmod 600 .env\n" +
        "  (create one at https://vercel.com/account/tokens)",
    );
  }

  const source = await readFile(file, "utf8");
  const ext = extname(file).toLowerCase();
  const input: PageInput = ext === ".html" || ext === ".htm" ? { kind: "html", source } : { kind: "markdown", source };

  // Pre-publish scan: hard-refuse secrets/PHI before anything leaves the machine.
  const sc = scan(source);
  if (sc.blocked.length) {
    note("Refusing to publish — possible secrets/PHI detected:");
    for (const h of sc.blocked) note(`  line ${h.line}: ${h.pattern} (${h.sample})`);
    fail("remove the flagged content (or it is a false positive — publish a redacted copy).");
  }
  for (const h of sc.warned) note(`warning: line ${h.line}: ${h.pattern} (${h.sample}) — review before sharing.`);

  note("Scanning for secrets/PHI… clean");
  const result = render(input, basename(file, ext));
  note(`Rendering… 1 page, ${result.blockIds.length} blocks`);
  const brand = loadBrand(dirname(file));

  const digits = opts.db || opts.llm ? 6 : 4;
  const pin = generatePin(digits);
  const salt = generateSalt();
  const hash = hashPin(pin, salt);
  const signingSecret = randomBytes(32).toString("hex");
  const ownerToken = randomBytes(24).toString("base64url");
  const pageId = `${slug(result.title)}-${randomBytes(3).toString("hex")}`;

  // runtime bundle
  const dist = distRoot();
  const runtimeFile = join(dist, "runtime", "runtime.js");
  const shaFile = join(dist, "runtime", "runtime.sha256");
  if (!existsSync(runtimeFile)) fail("runtime bundle missing — run `npm run build` first.");
  const runtimeJs = readFileSync(runtimeFile, "utf8");
  const runtimeSha = existsSync(shaFile) ? readFileSync(shaFile, "utf8").trim() : "dev";
  const runtimePath = `/__sh/runtime.${runtimeSha.slice(0, 12)}.js`;

  // NOTE: published pages do NOT call your local bridge — browsers block public https pages
  // from reaching localhost (Chrome Private Network Access / loopback permission). Deployed
  // thinking goes through the function (gateway/key); the local bridge is for LOCAL pages.

  // deployed page: runtime <script> baked in, NO inline boot (strict CSP).
  const pageHtml = renderPage({
    title: result.title,
    bodyHtml: result.html,
    toc: result.toc,
    brand,
    bodyEndExtra: `<script src="${runtimePath}"></script>`,
  });

  // bake page + runtime into the function bundle
  const fnFile = join(dist, "function", "k.js");
  if (!existsSync(fnFile)) fail("function bundle missing — run `npm run build` first.");
  let fnSrc = readFileSync(fnFile, "utf8");
  fnSrc = injectLiteral(fnSrc, "__SIMPLY_HTML_PAGE_HTML__", pageHtml);
  fnSrc = injectLiteral(fnSrc, "__SIMPLY_HTML_RUNTIME_JS__", runtimeJs);
  if (/__SIMPLY_HTML_(PAGE_HTML|RUNTIME_JS)__/.test(fnSrc)) {
    fail("internal: a function placeholder was not injected (build mismatch).");
  }

  // build the deploy directory. Its name becomes the auto-created Vercel project name,
  // so give it a clean slug.
  const projectName = `sh-${slug(result.title).slice(0, 28)}-${randomBytes(2).toString("hex")}`;
  const parent = await mkdtemp(join(tmpdir(), "sh-"));
  const deployDir = join(parent, projectName);
  await mkdir(join(deployDir, "api"), { recursive: true });
  await writeFile(join(deployDir, "api", "k.js"), fnSrc);
  await writeFile(
    join(deployDir, "vercel.json"),
    JSON.stringify({ version: 2, framework: null, rewrites: [{ source: "/(.*)", destination: "/api/k" }] }, null, 2),
  );
  const pkg: { private: boolean; type: string; dependencies?: Record<string, string> } = { private: true, type: "module" };
  if (opts.db || opts.llm) pkg.dependencies = { "@vercel/blob": "^2.4.1" };
  await writeFile(join(deployDir, "package.json"), JSON.stringify(pkg, null, 2));

  // env vars (secrets set over stdin, never argv)
  const env: Record<string, string> = {
    SIMPLY_HTML_PIN_HASH: hash,
    SIMPLY_HTML_PIN_SALT: salt,
    SIMPLY_HTML_SIGNING_SECRET: signingSecret,
    SIMPLY_HTML_OWNER_TOKEN: ownerToken,
    SIMPLY_HTML_PAGE_ID: pageId,
    SIMPLY_HTML_TITLE: result.title,
    SIMPLY_HTML_PIN_DIGITS: String(digits),
  };
  if (brand?.name) env.SIMPLY_HTML_BRAND_NAME = brand.name;
  if (brand?.accent) env.SIMPLY_HTML_ACCENT = brand.accent;
  if (opts.db) env.SIMPLY_HTML_DB = "1";
  if (opts.llm) {
    env.SIMPLY_HTML_LLM = "1";
    const modelKey = process.env.SIMPLY_HTML_MODEL_KEY || process.env.ANTHROPIC_API_KEY;
    if (modelKey) {
      // BYO Anthropic key override (NOTE: rides on argv via --env; move to `vercel env add`
      // over stdin before this ships broadly).
      env.SIMPLY_HTML_MODEL_KEY = modelKey;
      note("--llm: using your Anthropic key (BYO).");
    } else {
      // No key: the function uses Vercel AI Gateway via the auto-injected OIDC token —
      // no model key to manage, billed to your Vercel account.
      note("--llm: no model key — using Vercel AI Gateway (OIDC, billed to your Vercel account).");
    }
    if (process.env.SIMPLY_HTML_MODEL) env.SIMPLY_HTML_MODEL = process.env.SIMPLY_HTML_MODEL;
  }

  const bin = resolveVercel();
  // One non-interactive deploy: --yes auto-creates the project (named after the dir),
  // --env sets runtime env vars. No --token on argv (it goes through the environment).
  // NOTE: env values ride on argv here; the model key (--llm) should move to `vercel env
  // add` over stdin before --llm ships broadly.
  const args = ["deploy", "--prod", "--yes"];
  for (const [k, v] of Object.entries(env)) args.push("--env", `${k}=${v}`);

  note(`Deploying to Vercel as ${projectName} (PIN ${digits}-digit)…`);
  let usedScope: string | undefined;
  const deployArgs = (scope?: string) => (scope ? [...args, "--scope", scope] : args);
  let dep = await runVercel(bin, args, { token: token!, cwd: deployDir, timeoutMs: 240_000 });
  let url = parseDeployUrl(dep.stdout) || parseDeployUrl(dep.stderr);
  if (!url) {
    // Non-interactive mode needs an explicit scope; the CLI tells us which one. Retry with it.
    const scope = extractMissingScope(dep.stdout + dep.stderr);
    if (scope) {
      usedScope = scope;
      note(`Using Vercel scope ${scope}…`);
      dep = await runVercel(bin, deployArgs(scope), { token: token!, cwd: deployDir, timeoutMs: 240_000 });
      url = parseDeployUrl(dep.stdout) || parseDeployUrl(dep.stderr);
    }
  }
  if (dep.code !== 0 || !url) {
    fail(`deploy failed:\n${(dep.stderr || dep.stdout).split("\n").slice(-15).join("\n")}`);
  }

  // Turn OFF Vercel's own SSO/password protection so our PIN gate is the only gate.
  const ids = readProjectIds(deployDir);
  if (ids.projectId) {
    const r = await disableDeploymentProtection(ids.projectId, ids.orgId, token!);
    if (!r.ok) {
      note(`note: could not auto-disable Vercel deployment protection (HTTP ${r.status}).`);
      note("  Disable 'Vercel Authentication' in the project's Deployment Protection settings,");
      note("  otherwise the page sits behind a Vercel login instead of the PIN.");
    }
  }

  // --db and --llm both need a Blob store connected to the project (injects
  // BLOB_READ_WRITE_TOKEN for the data store / durable LLM caps), then a redeploy.
  if (opts.db || opts.llm) {
    const storeName = `sh-${randomBytes(4).toString("hex")}`;
    note(`Provisioning private Blob store ${storeName}…`);
    const csArgs = ["blob", "create-store", storeName, "--access", "private", "--yes"];
    if (usedScope) csArgs.push("--scope", usedScope);
    const cs = await runVercel(bin, csArgs, { token: token!, cwd: deployDir });
    if (cs.code !== 0) {
      note(`note: blob store provisioning may have failed:\n${(cs.stderr || cs.stdout).split("\n").slice(-4).join("\n")}`);
    }
    note("Redeploying with the Blob store…");
    const rd = await runVercel(bin, deployArgs(usedScope), { token: token!, cwd: deployDir, timeoutMs: 240_000 });
    const u2 = parseDeployUrl(rd.stdout) || parseDeployUrl(rd.stderr);
    if (u2) url = u2;
  }

  const access = `PIN ${pin}   (${digits}-digit${opts.db || opts.llm ? ", writable" : ", read-only"} — enter once, 30 days)`;
  if (opts.json) {
    process.stdout.write(JSON.stringify({ url, hub: `${url}/hub`, doc: pageId, access: { type: "pin", digits, pin } }) + "\n");
    return;
  }
  line("URL", url!);
  line("HUB", `${url}/hub`);
  line("DOC", pageId);
  line("ACCESS", access);
}
