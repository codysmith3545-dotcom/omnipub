import type { Platform, Article, PublishResult, DryRunResult, PublishOpts, HealthStatus, ErrorClass } from "./base.js";
import { getCredentials } from "../auth/store.js";

export class MediumPlatform implements Platform {
  name = "medium";

  private getToken(): string {
    const creds = getCredentials("medium");
    if (!creds) throw new Error("Medium not configured. Run: omnipub auth setup medium");
    return creds.value;
  }

  private async getUserId(): Promise<string> {
    const resp = await fetch("https://api.medium.com/v1/me", {
      headers: { Authorization: `Bearer ${this.getToken()}` },
    });
    if (!resp.ok) {
      throw new Error(`Medium /me failed (${resp.status}): ${await resp.text()}`);
    }
    const data = (await resp.json()) as { data: { id: string } };
    return data.data.id;
  }

  async publish(article: Article, _opts: PublishOpts): Promise<PublishResult> {
    try {
      const userId = await this.getUserId();

      const payload = {
        title: article.title,
        contentFormat: "markdown",
        content: article.body,
        tags: (article.tags ?? []).slice(0, 5).map((t) => t.replace(/[^a-zA-Z0-9]/g, "").slice(0, 25)).filter(Boolean),
        canonicalUrl: article.canonical,
        publishStatus: "public",
      };

      const resp = await fetch(`https://api.medium.com/v1/users/${userId}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Medium API error (${resp.status}): ${text}`);
      }

      const data = (await resp.json()) as { data: { url: string } };
      return {
        platform: this.name,
        success: true,
        url: data.data.url,
      };
    } catch (error) {
      return {
        platform: this.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async dryRun(article: Article): Promise<DryRunResult> {
    return {
      platform: this.name,
      wouldPublish: true,
      payload: {
        title: article.title,
        contentFormat: "markdown",
        tags: article.tags?.slice(0, 5),
        hasCanonical: !!article.canonical,
      },
    };
  }

  async authenticate(): Promise<void> {
    throw new Error("Set your Medium integration token via: omnipub auth setup medium");
  }

  async healthCheck(): Promise<HealthStatus> {
    const creds = getCredentials("medium");
    return {
      platform: this.name,
      authenticated: !!creds,
      reachable: true,
      issues: creds ? undefined : ["No integration token configured"],
    };
  }

  classifyError(error: unknown): ErrorClass {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("401")) return "auth_expired";
    if (msg.includes("429")) return "rate_limit";
    return "unknown";
  }
}
