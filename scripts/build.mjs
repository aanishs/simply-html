// simply-html build orchestrator.
// Two esbuild targets:
//   1. runtime -> a single browser IIFE (the audited runtime that owns all interactivity)
//   2. cli     -> a Node ESM binary
// The runtime bundle is content-hashed; its sha256 is written next to it so the
// CLI/function can serve a verifiable, drift-checked bundle.
import { build } from "esbuild";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const dist = `${root}dist`;

await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/runtime`, { recursive: true });
await mkdir(`${dist}/cli`, { recursive: true });

// --- 1. Browser runtime (IIFE, no node libs) ---
const runtimeOut = `${dist}/runtime/runtime.js`;
await build({
  entryPoints: [`${root}src/runtime/index.ts`],
  outfile: runtimeOut,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  treeShaking: true,
  legalComments: "none",
});
const runtimeBytes = await readFile(runtimeOut);
const sha = createHash("sha256").update(runtimeBytes).digest("hex");
await writeFile(`${dist}/runtime/runtime.sha256`, sha);
console.log(`runtime: dist/runtime/runtime.js  sha256=${sha.slice(0, 12)}…`);

// --- 1b. The serverless function (Node ESM, placeholders preserved, @vercel/blob external) ---
await mkdir(`${dist}/function`, { recursive: true });
await build({
  entryPoints: [`${root}src/function/handler.ts`],
  outfile: `${dist}/function/k.js`,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  // NO minify: publish injects per-page values by replacing the quoted placeholder literals.
  minify: false,
  // @vercel/blob is only required on the --db/--llm path; installed in the deploy dir when needed.
  external: ["@vercel/blob"],
  legalComments: "none",
});
console.log("function: dist/function/k.js");

// --- 2. CLI (Node ESM) ---
await build({
  entryPoints: [`${root}src/cli/index.ts`],
  outfile: `${dist}/cli/index.js`,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  // Keep node-heavy / native deps external; they resolve from node_modules at runtime.
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
});
console.log("cli: dist/cli/index.js");

// Make the CLI executable.
if (existsSync(`${dist}/cli/index.js`)) {
  const { chmod } = await import("node:fs/promises");
  await chmod(`${dist}/cli/index.js`, 0o755);
}
console.log("build complete");
