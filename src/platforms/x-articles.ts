import type { Platform, Article, PublishResult, DryRunResult, PublishOpts, HealthStatus, ErrorClass } from "./base.js";
import { getCredentials } from "../auth/store.js";
import { refreshXCookies } from "../auth/cookie-refresh.js";
import { loadHashes, refreshHashes, isStaleError, type XOperationHashes } from "../healing/x-hash-refresh.js";
import { loadMedia } from "../media/upload.js";

type GraphQLResponse = {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
};

type MediaInitResponse = {
  media_id_string: string;
};

export class XArticlesPlatform implements Platform {
  name = "x";
  private hashes: XOperationHashes | null = null;

  invalidateHashes(): void {
    this.hashes = null;
  }

  private getCookies(): Record<string, string> {
    const creds = getCredentials("x");
    if (!creds) throw new Error("X cookies not configured. Run: omnipub auth setup x");
    const cookies = JSON.parse(creds.value) as ReadonlyArray<{ name: string; value: string }>;
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

  private async graphql(opName: keyof Omit<XOperationHashes, "refreshedAt">, variables: unknown): Promise<GraphQLResponse> {
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
      body: JSON.stringify({
        variables,
        queryId: hash,
        features: {
          articles_preview_enabled: true,
          c9s_tweet_anatomy_moderator_badge_enabled: true,
          creator_subscriptions_tweet_preview_api_enabled: true,
          freedom_of_speech_not_reach_fetch_enabled: true,
          longform_notetweets_consumption_enabled: true,
          longform_notetweets_inline_media_enabled: true,
          longform_notetweets_rich_text_read_enabled: true,
          responsive_web_edit_tweet_api_enabled: true,
          responsive_web_enhance_cards_enabled: false,
          responsive_web_graphql_exclude_directive_enabled: true,
          responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
          responsive_web_graphql_timeline_navigation_enabled: true,
          responsive_web_media_download_video_enabled: false,
          responsive_web_twitter_article_tweet_consumption_enabled: true,
          rweb_tipjar_consumption_enabled: true,
          standardized_nudges_misinfo: true,
          tweet_awards_web_tipping_enabled: false,
          tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
          tweetypie_unmention_optimization_enabled: true,
          verified_phone_label_enabled: false,
          view_counts_everywhere_api_enabled: true,
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`X GraphQL ${opName} failed (${resp.status}): ${text}`);
    }

    const body = (await resp.json()) as GraphQLResponse;
    if (body.errors && body.errors.length > 0) {
      throw new Error(`X GraphQL ${opName} returned errors: ${body.errors.map((e) => e.message).join(", ")}`);
    }
    return body;
  }

  async publish(article: Article, _opts: PublishOpts): Promise<PublishResult> {
    try {
      const draft = await this.graphql("ArticleEntityDraftCreate", {});
      const articleId = (draft.data?.["article_entity_draft_create"] as Record<string, unknown> | undefined)?.["id"] as string | undefined;
      if (!articleId) throw new Error("Failed to create draft — no article ID returned");

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
    type Block = { key: string; text: string; type: string; entityRanges: readonly unknown[]; inlineStyleRanges: ReadonlyArray<{ offset: number; length: number; style: string }> };
    const blocks: Block[] = [];
    const lines = markdown.split("\n");
    let blockIndex = 0;
    let inCodeBlock = false;
    let codeLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          blocks.push({
            key: `block-${blockIndex++}`,
            text: codeLines.join("\n"),
            type: "code-block",
            entityRanges: [],
            inlineStyleRanges: [],
          });
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      if (line.trim() === "") continue;

      if (line.match(/^!\[.*\]\(.*\)$/)) continue;

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
      } else if (line.match(/^\d+\.\s/)) {
        type = "ordered-list-item";
        text = line.replace(/^\d+\.\s/, "");
      }

      const { stripped, styles } = this.stripAndExtractStyles(text);

      blocks.push({
        key: `block-${blockIndex++}`,
        text: stripped,
        type,
        entityRanges: [],
        inlineStyleRanges: styles,
      });
    }

    return { blocks, entityMap: {} };
  }

  private stripAndExtractStyles(raw: string): { stripped: string; styles: Array<{ offset: number; length: number; style: string }> } {
    const styles: Array<{ offset: number; length: number; style: string }> = [];

    type Span = { start: number; end: number; markerLen: number; appliedStyles: readonly string[] };
    const spans: Span[] = [];
    let match;
    const claimed = new Set<number>();

    const boldItalicRegex = /\*\*\*(.+?)\*\*\*/g;
    while ((match = boldItalicRegex.exec(raw)) !== null) {
      const span = { start: match.index, end: match.index + match[0].length, markerLen: 3, appliedStyles: ["BOLD", "ITALIC"] as const };
      spans.push(span);
      for (let i = span.start; i < span.end; i++) claimed.add(i);
    }

    const boldRegex = /\*\*(.+?)\*\*/g;
    while ((match = boldRegex.exec(raw)) !== null) {
      if (claimed.has(match.index)) continue;
      const span = { start: match.index, end: match.index + match[0].length, markerLen: 2, appliedStyles: ["BOLD"] as const };
      spans.push(span);
      for (let i = span.start; i < span.end; i++) claimed.add(i);
    }

    const italicRegex = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
    while ((match = italicRegex.exec(raw)) !== null) {
      if (claimed.has(match.index)) continue;
      const span = { start: match.index, end: match.index + match[0].length, markerLen: 1, appliedStyles: ["ITALIC"] as const };
      spans.push(span);
      for (let i = span.start; i < span.end; i++) claimed.add(i);
    }

    if (spans.length === 0) return { stripped: raw, styles: [] };

    spans.sort((a, b) => a.start - b.start);

    let stripped = "";
    const offsetMap: number[] = [];

    for (let i = 0; i < raw.length; i++) {
      const inSpan = spans.find((s) => i >= s.start && i < s.end);
      if (inSpan) {
        if (i < inSpan.start + inSpan.markerLen || i >= inSpan.end - inSpan.markerLen) {
          offsetMap.push(-1);
          continue;
        }
      }
      offsetMap.push(stripped.length);
      stripped += raw[i];
    }

    for (const span of spans) {
      const contentStart = span.start + span.markerLen;
      const contentEnd = span.end - span.markerLen;
      const mappedStart = offsetMap[contentStart];
      const mappedEnd = offsetMap[contentEnd - 1];
      if (mappedStart !== undefined && mappedStart >= 0 && mappedEnd !== undefined && mappedEnd >= 0) {
        for (const style of span.appliedStyles) {
          styles.push({ offset: mappedStart, length: mappedEnd - mappedStart + 1, style });
        }
      }
    }

    return { stripped, styles };
  }

  private async uploadMedia(buffer: Buffer, mimeType: string): Promise<string> {
    const headers = this.getHeaders();

    const initResp = await fetch("https://upload.twitter.com/i/media/upload.json", {
      method: "POST",
      headers,
      body: JSON.stringify({
        command: "INIT",
        total_bytes: buffer.length,
        media_type: mimeType,
      }),
    });
    if (!initResp.ok) {
      throw new Error(`X media INIT failed (${initResp.status}): ${await initResp.text()}`);
    }
    const initData = (await initResp.json()) as MediaInitResponse;

    const form = new FormData();
    form.append("command", "APPEND");
    form.append("media_id", initData.media_id_string);
    form.append("segment_index", "0");
    form.append("media", new Blob([buffer], { type: mimeType }));

    const { "content-type": _, ...headersWithoutContentType } = headers;
    const appendResp = await fetch("https://upload.twitter.com/i/media/upload.json", {
      method: "POST",
      headers: headersWithoutContentType,
      body: form,
    });
    if (!appendResp.ok) {
      throw new Error(`X media APPEND failed (${appendResp.status}): ${await appendResp.text()}`);
    }

    const finalResp = await fetch("https://upload.twitter.com/i/media/upload.json", {
      method: "POST",
      headers,
      body: JSON.stringify({
        command: "FINALIZE",
        media_id: initData.media_id_string,
      }),
    });
    if (!finalResp.ok) {
      throw new Error(`X media FINALIZE failed (${finalResp.status}): ${await finalResp.text()}`);
    }

    return initData.media_id_string;
  }
}
