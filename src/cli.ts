#!/usr/bin/env node
import { Command } from "commander";
import { parseMarkdownFile } from "./core/parser.js";
import { publish, doctor } from "./core/publisher.js";
import { initConfig, loadConfig } from "./core/config.js";
import { hasCredentials, saveCredentials } from "./auth/store.js";
import { extractCookiesFromBrowser } from "./auth/cookie-refresh.js";
import { setupMediumToken } from "./auth/oauth.js";

const program = new Command();

program
  .name("omnipub")
  .description("One markdown file, published everywhere.")
  .version("0.1.0");

program
  .command("publish <file>")
  .description("Publish a markdown file to all configured platforms")
  .option("--post", "Actually publish (default is dry-run)")
  .option("--only <platforms>", "Comma-separated list of platforms to publish to")
  .option("--exclude <platforms>", "Comma-separated list of platforms to skip")
  .option("--agent", "Agent mode: JSON output, no prompts, no color")
  .action(async (file: string, opts: Record<string, string | boolean | undefined>) => {
    const article = parseMarkdownFile(file);
    const dryRun = !opts["post"];
    const agent = !!opts["agent"];
    const only = opts["only"] ? (opts["only"] as string).split(",") : undefined;
    const exclude = opts["exclude"] ? (opts["exclude"] as string).split(",") : undefined;

    if (!agent && dryRun) {
      console.log("DRY RUN — add --post to publish for real\n");
    }

    const results = await publish(article, { dryRun, agent, only, exclude });
    const succeeded = results.filter((r) => r.success).length;

    if (agent) {
      console.log(JSON.stringify({ results, summary: `${succeeded}/${results.length} published` }));
    } else {
      for (const r of results) {
        const icon = r.success ? "+" : "x";
        const heal = r.healed ? " (self-healed)" : "";
        console.log(`[${icon}] ${r.platform}: ${r.url ?? r.error ?? "ok"}${heal}`);
      }
      console.log(`\n${succeeded}/${results.length} published successfully`);
    }
  });

program
  .command("doctor")
  .description("Check auth and connectivity for all platforms")
  .option("--platform <name>", "Check a specific platform")
  .option("--agent", "JSON output")
  .action(async (opts: Record<string, string | boolean | undefined>) => {
    const results = await doctor(opts["platform"] as string | undefined);

    if (opts["agent"]) {
      console.log(JSON.stringify(results));
    } else {
      for (const r of results as any[]) {
        const icon = r.authenticated ? "+" : "x";
        console.log(`[${icon}] ${r.platform}`);
        if (r.issues) {
          for (const issue of r.issues) {
            console.log(`    - ${issue}`);
          }
        }
      }
    }
  });

const auth = program.command("auth").description("Manage platform authentication");

auth
  .command("setup <platform>")
  .description("Set up authentication for a platform")
  .action(async (platform: string) => {
    switch (platform) {
      case "x":
      case "substack": {
        console.log(`Extracting ${platform} cookies from running Chrome (port 9222)...`);
        const url = platform === "x" ? "https://x.com" : "https://substack.com";
        const ok = await extractCookiesFromBrowser(url, platform);
        console.log(ok ? "Cookies saved." : "Failed — make sure you're logged in to Chrome.");
        break;
      }
      case "medium": {
        const token = process.argv[process.argv.length - 1];
        if (!token || token === "medium") {
          console.log("Usage: omnipub auth setup medium <integration-token>");
          console.log("Get your token from: https://medium.com/me/settings/security");
          break;
        }
        await setupMediumToken(token);
        console.log("Medium token saved.");
        break;
      }
      case "linkedin": {
        console.log("LinkedIn OAuth setup:");
        console.log("1. Create an app at https://www.linkedin.com/developers/");
        console.log("2. Set redirect URI to http://localhost:3847/callback");
        console.log("3. Run: omnipub auth setup linkedin <client-id> <client-secret>");
        break;
      }
      default:
        console.error(`Unknown platform: ${platform}`);
    }
  });

auth
  .command("status")
  .description("Show auth status for all platforms")
  .action(() => {
    for (const p of ["x", "linkedin", "medium", "substack"]) {
      const icon = hasCredentials(p) ? "+" : "x";
      console.log(`[${icon}] ${p}`);
    }
  });

const config = program.command("config").description("Manage configuration");

config
  .command("init")
  .description("Create default config file")
  .action(() => {
    const path = initConfig();
    console.log(`Config created at ${path}`);
  });

config
  .command("show")
  .description("Show current configuration")
  .action(() => {
    console.log(JSON.stringify(loadConfig(), null, 2));
  });

program.parse();
