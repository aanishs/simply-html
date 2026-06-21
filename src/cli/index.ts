// simply-html CLI entrypoint. The two SKILL.md folders shell out to these commands.
import { Command } from "commander";
import { previewCommand } from "./commands/preview.js";
import { brandCommand } from "./commands/brand.js";
import { publishCommand } from "./commands/publish.js";
import { bridgeCommand } from "./commands/bridge.js";

const program = new Command();

program
  .name("simply-html")
  .description("Turn agent-made markdown/HTML into a beautiful, PIN-gated page with a hub.")
  .version("0.0.0");

program
  .command("preview")
  .description("Render a markdown/HTML file and serve it on the shared local bridge daemon.")
  .argument("<file>", "markdown or HTML file")
  .action((file: string) => previewCommand(file));

program
  .command("bridge")
  .description("Run the local bridge daemon that powers preview pages — think + select-to-edit — via your CLI.")
  .option("--port <port>", "port to listen on (default 4319)")
  .action((opts) => bridgeCommand(opts));

program
  .command("brand")
  .description("Set a minimalist brand (one accent, one logo) and apply it to every page.")
  .argument("<action>", "show | set")
  .option("--name <name>", "brand/display name shown in the page header")
  .option("--accent <hex>", "accent color, e.g. #e0603a")
  .option("--font <font>", "body font stack override")
  .option("--density <density>", "comfortable | compact")
  .option("--logo <path>", "logo image (raster: png/jpg/gif/webp)")
  .option("--dir <path>", "where to write simply-html.brand.json (default: cwd)")
  .action((action: string, opts) => brandCommand(action, opts));

program
  .command("publish")
  .description("Deploy a page to a real URL behind a PIN gate (needs VERCEL_TOKEN).")
  .argument("<file>", "markdown or HTML file")
  .option("--db", "enable the todo/list data store")
  .option("--llm", "enable the deployed LLM proxy (BYO model key)")
  .option("--json", "emit machine-readable JSON")
  .action((file: string, opts) => publishCommand(file, opts));

program.parseAsync(process.argv);
