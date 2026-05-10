import type { Platform, Article, PublishResult, DryRunResult, PublishOpts, HealthStatus, ErrorClass } from "./base.js";
import { getCredentials } from "../auth/store.js";
import { refreshXCookies } from "../auth/cookie-refresh.js";
import { loadHashes, refreshHashes, isStaleError, type XOperationHashes } from "../healing/x-hash-refresh.js";
import { loadMedia } from "../media/upload.js";

export class XArticlesPlatform implements Platform {
  name = "x";
  private hashes: XOperationHashes | null = null;

  private getCookies(): Record<string, string> {
    const creds = getCredentials("x");
    if (!creds) throw new Error("X cookies not configured. Run: omnipub auth setup x");
    const cookies = JSON.parse(creds.value) as Array<{ name: string; value: string }>;
    return Object.fromEntries(cookies.map((c) => [c.name, c.value]));
  }

  private getHeaders(): Record<string, string> {
    const cookies = this.getCookies();
    return {
      "content-type": "application/json",
      "x-csrf-token": cookies["ct0"] ?? "",
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    };
  }

  private async graphql(opName: keyof Omit<XOperationHashes, "refreshedAt">, variables: unknown): Promise<unknown> {
    if (!this.hashes) {
      this.hashes = loadHashes();
      if (!this.hashes) {
        this.hashes = await refreshHashes();
      }
    }
    const hash = this.hashes[opName];
    if (!hash) throw new Error(`Missing hash for ${opName}. Run hash refresh.`);

    const resp = await fetch(`https://x.com/i/api/graphql/${hash}/${opName}`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ variables, queryId: hash }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`X GraphQL ${opName} failed (${resp.status}): ${text}`);
    }
    return resp.json();
  }

  async publish(article: Article, opts: PublishOpts): Promise<PublishResult> {
    try {
      const draft = (await this.graphql("ArticleEntityDraftCreate", {})) as any;
      const articleId = draft?.data?.article_entity_draft_create?.id;
      if (!articleId) throw new Error("Failed to create draft");

      await this.graphql("ArticleEntityUpdateTitle", {
        article_id: articleId,
        title: article.title,
      });

      const contentState = this.markdownToContentState(article.body);
      await this.graphql("ArticleEntityUpdateContent", {
        article_id: articleId,
        content_state: JSON.stringify(contentState),
      });

      if (article.cover) {
        const media = loadMedia(article.cover);
        const mediaId = await this.uploadMedia(media.buffer, media.mimeType);
        await this.graphql("ArticleEntityUpdateCoverMedia", {
          article_id: articleId,
          media_id: mediaId,
        });
      }

      await this.graphql("ArticleEntityPublish", { article_id: articleId });

      return {
        platform: this.name,
        success: true,
        url: `https://x.com/i/articles/${articleId}`,
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
    const contentState = this.markdownToContentState(article.body);
    return {
      platform: this.name,
      wouldPublish: true,
      payload: {
        title: article.title,
        contentState,
        hasCover: !!article.cover,
        tags: article.tags,
      },
    };
  }

  async authenticate(): Promise<void> {
    const refreshed = await refreshXCookies();
    if (!refreshed) {
      throw new Error("Could not refresh X cookies. Log in manually and re-export.");
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const creds = getCredentials("x");
    const hashes = loadHashes();
    const issues: string[] = [];
    if (!creds) issues.push("No cookies configured");
    if (!hashes) issues.push("No GraphQL hashes cached");
    return {
      platform: this.name,
      authenticated: !!creds,
      reachable: true,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  classifyError(error: unknown): ErrorClass {
    if (isStaleError(error)) return "hash_stale";
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("401") || msg.includes("403")) return "auth_expired";
    if (msg.includes("429")) return "rate_limit";
    return "unknown";
  }

  private markdownToContentState(markdown: string): object {
    const blocks: Array<{ key: string; text: string; type: string; entityRanges: unknown[]; inlineStyleRanges: unknown[] }> = [];
    const lines = markdown.split("\n");
    let blockIndex = 0;

    for (const line of lines) {
      if (line.trim() === "") continue;

      let type = "unstyled";
      let text = line;

      if (line.startsWith("## ")) {
        type = "header-two";
        text = line.slice(3);
      } else if (line.startsWith("# ")) {
        type = "header-one";
        text = line.slice(2);
      } else if (line.startsWith("> ")) {
        type = "blockquote";
        text = line.slice(2);
      } else if (line.match(/^[-*] /)) {
        type = "unordered-list-item";
        text = line.slice(2);
      } else if (line.match(/^\d+\. /)) {
        type = "ordered-list-item";
        text = line.replace(/^\d+\. /, "");
      }

      blocks.push({
        key: `block-${blockIndex++}`,
        text,
        type,
        entityRanges: [],
        inlineStyleRanges: this.extractInlineStyles(text),
      });
    }

    return { blocks, entityMap: {} };
  }

  private extractInlineStyles(text: string): Array<{ offset: number; length: number; style: string }> {
    const styles: Array<{ offset: number; length: number; style: string }> = [];
    let match;

    const boldRegex = /\*\*(.+?)\*\*/g;
    while ((match = boldRegex.exec(text)) !== null) {
      styles.push({ offset: match.index, length: match[1]!.length + 4, style: "BOLD" });
    }

    const italicRegex = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
    while ((match = italicRegex.exec(text)) !== null) {
      styles.push({ offset: match.index, length: match[1]!.length + 2, style: "ITALIC" });
    }

    return styles;
  }

  private async uploadMedia(buffer: Buffer, mimeType: string): Promise<string> {
    const initResp = await fetch("https://upload.x.com/i/media/upload.json", {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        command: "INIT",
        total_bytes: buffer.length,
        media_type: mimeType,
      }),
    });
    const initData = (await initResp.json()) as { media_id_string: string };

    const form = new FormData();
    form.append("command", "APPEND");
    form.append("media_id", initData.media_id_string);
    form.append("segment_index", "0");
    form.append("media", new Blob([buffer], { type: mimeType }));

    await fetch("https://upload.x.com/i/media/upload.json", {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "content-type": undefined as any,
      },
      body: form,
    });

    await fetch("https://upload.x.com/i/media/upload.json", {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        command: "FINALIZE",
        media_id: initData.media_id_string,
      }),
    });

    return initData.media_id_string;
  }
}
