#!/usr/bin/env node
import { Command } from "commander";
import { parseMarkdownFile } from "./core/parser.js";
import { publish, doctor } from "./core/publisher.js";
import { initConfig, loadConfig } from "./core/config.js";
import { hasCredentials } from "./auth/store.js";
import { extractCookiesFromBrowser } from "./auth/cookie-refresh.js";
import { setupMediumToken, setupLinkedInOAuth, exchangeLinkedInCode } from "./auth/oauth.js";
import { createServer } from "http";

const program = new Command();

program
  .name("omnipub")
  .description("One markdown file, published everywhere.")
  .version("0.1.0");

function handleError(error: unknown, agent: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (agent) {
    console.log(JSON.stringify({ results: [], summary: "0/0 published", error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

program
  .command("publish <file>")
  .description("Publish a markdown file to all configured platforms")
  .option("--post", "Actually publish (default is dry-run)")
  .option("--only <platforms>", "Comma-separated list of platforms to publish to")
  .option("--exclude <platforms>", "Comma-separated list of platforms to skip")
  .option("--agent", "Agent mode: JSON output, no prompts, no color")
  .action(async (file: string, opts: Record<string, string | boolean | undefined>) => {
    const agent = !!opts["agent"];
    try {
      const article = parseMarkdownFile(file);
      const dryRun = !opts["post"];
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
    } catch (error) {
      handleError(error, agent);
    }
  });

program
  .command("doctor")
  .description("Check auth and connectivity for all platforms")
  .option("--platform <name>", "Check a specific platform")
  .option("--agent", "JSON output")
  .action(async (opts: Record<string, string | boolean | undefined>) => {
    const agent = !!opts["agent"];
    try {
      const results = await doctor(opts["platform"] as string | undefined);

      if (agent) {
        console.log(JSON.stringify(results));
      } else {
        for (const r of results) {
          const icon = r.authenticated ? "+" : "x";
          console.log(`[${icon}] ${r.platform}`);
          if (r.issues) {
            for (const issue of r.issues) {
              console.log(`    - ${issue}`);
            }
          }
        }
      }
    } catch (error) {
      handleError(error, agent);
    }
  });

const auth = program.command("auth").description("Manage platform authentication");

auth
  .command("setup <platform>")
  .description("Set up authentication for a platform")
  .argument("[args...]", "Additional arguments (token, client-id, client-secret)")
  .action(async (platform: string, args: string[]) => {
    switch (platform) {
      case "x":
      case "substack": {
        console.log(`Extracting ${platform} cookies from running Chrome (port 9222)...`);
        const url = platform === "x" ? "https://x.com" : "https://substack.com";
        const ok = await extractCookiesFromBrowser(url, platform);
        console.log(ok ? "Cookies saved." : "Failed — make sure you're logged in to Chrome with remote debugging enabled.");
        break;
      }
      case "medium": {
        if (args.length === 0) {
          console.log("Usage: omnipub auth setup medium <integration-token>");
          console.log("Get your token from: https://medium.com/me/settings/security");
          break;
        }
        await setupMediumToken(args[0]!);
        console.log("Medium token saved.");
        break;
      }
      case "linkedin": {
        if (args.length < 2) {
          console.log("Usage: omnipub auth setup linkedin <client-id> <client-secret>");
          console.log("1. Create an app at https://www.linkedin.com/developers/");
          console.log("2. Set redirect URI to http://localhost:3847/callback");
          break;
        }
        const [clientId, clientSecret] = args as [string, string];
        const authUrl = await setupLinkedInOAuth(clientId, clientSecret);
        console.log(`Open this URL to authorize:\n${authUrl}\n`);
        console.log("Waiting for OAuth callback on http://localhost:3847/callback ...");

        await new Promise<void>((resolve, reject) => {
          const server = createServer(async (req, res) => {
            const url = new URL(req.url ?? "", "http://localhost:3847");
            const code = url.searchParams.get("code");
            if (!code) {
              res.writeHead(400);
              res.end("Missing code parameter");
              return;
            }
            try {
              await exchangeLinkedInCode(code, clientId, clientSecret);
              res.writeHead(200);
              res.end("LinkedIn authorized. You can close this tab.");
              console.log("LinkedIn OAuth token saved.");
              server.close();
              resolve();
            } catch (err) {
              res.writeHead(500);
              res.end("OAuth exchange failed");
              server.close();
              reject(err);
            }
          });
          server.listen(3847);
        });
        break;
      }
      default:
        console.error(`Unknown platform: ${platform}. Valid: x, linkedin, medium, substack`);
        process.exit(1);
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
