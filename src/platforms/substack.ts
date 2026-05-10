import { marked } from "marked";
import type { Platform, Article, PublishResult, DryRunResult, PublishOpts, HealthStatus, ErrorClass } from "./base.js";
import { getCredentials } from "../auth/store.js";

type SubstackDraftResponse = {
  id: number;
  slug: string;
  publication_id: number;
};

type SubstackPublishResponse = {
  id: number;
  slug: string;
  canonical_url: string;
};

export class SubstackPlatform implements Platform {
  name = "substack";

  private getCookieHeader(): string {
    const creds = getCredentials("substack");
    if (!creds) throw new Error("Substack not configured. Run: omnipub auth setup substack");
    const cookies = JSON.parse(creds.value) as ReadonlyArray<{ name: string; value: string }>;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  private getSubdomain(): string {
    const creds = getCredentials("substack");
    if (!creds) throw new Error("Substack not configured");
    const cookies = JSON.parse(creds.value) as ReadonlyArray<{ name: string; value: string; domain: string }>;
    const substackCookie = cookies.find((c) => c.domain.endsWith(".substack.com") && c.domain !== ".substack.com");
    if (substackCookie) {
      return substackCookie.domain.replace(/^\./, "").replace(".substack.com", "");
    }
    throw new Error("Could not determine Substack publication subdomain from cookies. Set publication in config.");
  }

  async publish(article: Article, _opts: PublishOpts): Promise<PublishResult> {
    try {
      const subdomain = this.getSubdomain();
      const baseUrl = `https://${subdomain}.substack.com`;
      const cookieHeader = this.getCookieHeader();
      const bodyHtml = marked.parse(article.body, { async: false }) as string;

      const draftResp = await fetch(`${baseUrl}/api/v1/drafts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          draft_title: article.title,
          draft_subtitle: article.summary ?? "",
          draft_body: bodyHtml,
        }),
      });

      if (!draftResp.ok) {
        const text = await draftResp.text();
        if (text.includes("login") || text.includes("sign_in") || draftResp.status === 401) {
          return { platform: this.name, success: false, error: "Cookies expired. Run: omnipub auth setup substack" };
        }
        throw new Error(`Substack draft creation failed (${draftResp.status}): ${text}`);
      }

      const draft = (await draftResp.json()) as SubstackDraftResponse;

      const publishResp = await fetch(`${baseUrl}/api/v1/drafts/${draft.id}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({}),
      });

      if (!publishResp.ok) {
        throw new Error(`Substack publish failed (${publishResp.status}): ${await publishResp.text()}`);
      }

      const published = (await publishResp.json()) as SubstackPublishResponse;

      return {
        platform: this.name,
        success: true,
        url: published.canonical_url ?? `${baseUrl}/p/${published.slug}`,
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
    if (msg.includes("login") || msg.includes("sign in") || msg.includes("Cookies expired") || msg.includes("401")) return "auth_expired";
    return "unknown";
  }
}
