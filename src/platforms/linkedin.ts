import type { Platform, Article, PublishResult, DryRunResult, PublishOpts, HealthStatus, ErrorClass } from "./base.js";
import { getCredentials } from "../auth/store.js";

type LinkedInUserInfo = { sub: string };
type LinkedInPostResponse = { id: string };

export class LinkedInPlatform implements Platform {
  name = "linkedin";

  private getToken(): string {
    const creds = getCredentials("linkedin");
    if (!creds) throw new Error("LinkedIn not configured. Run: omnipub auth setup linkedin");
    return creds.value;
  }

  private async getAuthorUrn(): Promise<string> {
    const resp = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${this.getToken()}` },
    });
    if (!resp.ok) {
      throw new Error(`LinkedIn userinfo failed (${resp.status}): ${await resp.text()}`);
    }
    const data = (await resp.json()) as LinkedInUserInfo;
    return `urn:li:person:${data.sub}`;
  }

  async publish(article: Article, _opts: PublishOpts): Promise<PublishResult> {
    try {
      const authorUrn = await this.getAuthorUrn();

      const payload = {
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: {
              text: `${article.title}\n\n${article.body}`,
            },
            shareMediaCategory: article.canonical ? "ARTICLE" as const : "NONE" as const,
            ...(article.canonical
              ? {
                  media: [
                    {
                      status: "READY",
                      originalUrl: article.canonical,
                      title: { text: article.title },
                      description: { text: article.summary ?? "" },
                    },
                  ],
                }
              : {}),
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      };

      const resp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.getToken()}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        throw new Error(`LinkedIn API error (${resp.status}): ${await resp.text()}`);
      }

      const data = (await resp.json()) as LinkedInPostResponse;
      return {
        platform: this.name,
        success: true,
        url: `https://www.linkedin.com/feed/update/${data.id}`,
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
        bodyLength: article.body.length,
        summary: article.summary,
        tags: article.tags,
        hasCanonical: !!article.canonical,
      },
    };
  }

  async authenticate(): Promise<void> {
    throw new Error("Use 'omnipub auth setup linkedin' for OAuth flow");
  }

  async healthCheck(): Promise<HealthStatus> {
    const creds = getCredentials("linkedin");
    const issues: string[] = [];
    if (!creds) {
      issues.push("No OAuth token configured");
    } else if (creds.expiresAt && new Date(creds.expiresAt) < new Date()) {
      issues.push("OAuth token expired");
    }
    return {
      platform: this.name,
      authenticated: !!creds,
      reachable: true,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  classifyError(error: unknown): ErrorClass {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("401") || msg.includes("expired")) return "auth_expired";
    if (msg.includes("429")) return "rate_limit";
    return "unknown";
  }
}
