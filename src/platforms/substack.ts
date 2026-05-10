import { chromium } from "playwright";
import type { Platform, Article, PublishResult, DryRunResult, PublishOpts, HealthStatus, ErrorClass } from "./base.js";
import { getCredentials } from "../auth/store.js";

export class SubstackPlatform implements Platform {
  name = "substack";

  private getCookies(): Array<{ name: string; value: string; domain: string }> {
    const creds = getCredentials("substack");
    if (!creds) throw new Error("Substack not configured. Run: omnipub auth setup substack");
    return JSON.parse(creds.value);
  }

  async publish(article: Article, _opts: PublishOpts): Promise<PublishResult> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.addCookies(this.getCookies());
      const page = await context.newPage();

      await page.goto("https://substack.com/publish/post", { waitUntil: "networkidle" });

      const titleInput = page.locator('[data-testid="post-title"], [placeholder*="Title"]').first();
      await titleInput.fill(article.title);

      const bodyEditor = page.locator('[role="textbox"], .ProseMirror').first();
      await bodyEditor.click();

      for (const line of article.body.split("\n")) {
        await page.keyboard.type(line);
        await page.keyboard.press("Enter");
      }

      if (article.summary) {
        const subtitleInput = page.locator('[data-testid="post-subtitle"], [placeholder*="subtitle"]').first();
        if (await subtitleInput.isVisible()) {
          await subtitleInput.fill(article.summary);
        }
      }

      const publishButton = page.locator('button:has-text("Publish")').first();
      await publishButton.click();

      const confirmButton = page.locator('button:has-text("Publish now"), button:has-text("Confirm")').first();
      if (await confirmButton.isVisible({ timeout: 3000 })) {
        await confirmButton.click();
      }

      await page.waitForTimeout(3000);

      return {
        platform: this.name,
        success: true,
        url: page.url(),
      };
    } catch (error) {
      return {
        platform: this.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await browser.close();
    }
  }

  async dryRun(article: Article): Promise<DryRunResult> {
    return {
      platform: this.name,
      wouldPublish: true,
      payload: {
        title: article.title,
        bodyLength: article.body.length,
        hasCover: !!article.cover,
        summary: article.summary,
      },
    };
  }

  async authenticate(): Promise<void> {
    throw new Error("Log into Substack in your browser, then run: omnipub auth setup substack");
  }

  async healthCheck(): Promise<HealthStatus> {
    const creds = getCredentials("substack");
    return {
      platform: this.name,
      authenticated: !!creds,
      reachable: true,
      issues: creds ? undefined : ["No cookies configured"],
    };
  }

  classifyError(error: unknown): ErrorClass {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("login") || msg.includes("sign in")) return "auth_expired";
    return "unknown";
  }
}
