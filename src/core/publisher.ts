import type { Article, Platform, PublishResult, PublishOpts } from "../platforms/base.js";
import { XArticlesPlatform } from "../platforms/x-articles.js";
import { LinkedInPlatform } from "../platforms/linkedin.js";
import { MediumPlatform } from "../platforms/medium.js";
import { SubstackPlatform } from "../platforms/substack.js";
import { refreshXCookies, refreshSubstackCookies } from "../auth/cookie-refresh.js";
import { refreshHashes } from "../healing/x-hash-refresh.js";
import { loadConfig } from "./config.js";

const ALL_PLATFORMS: Record<string, () => Platform> = {
  x: () => new XArticlesPlatform(),
  linkedin: () => new LinkedInPlatform(),
  medium: () => new MediumPlatform(),
  substack: () => new SubstackPlatform(),
};

function resolvePlatforms(article: Article, only?: string[], exclude?: string[]): Platform[] {
  const config = loadConfig();
  let names = Object.keys(ALL_PLATFORMS);

  if (article.platforms && article.platforms.length > 0) {
    names = names.filter((n) => article.platforms!.includes(n));
  }
  if (only && only.length > 0) {
    names = names.filter((n) => only.includes(n));
  }
  if (exclude && exclude.length > 0) {
    names = names.filter((n) => !exclude.includes(n));
  }

  names = names.filter((n) => {
    const platformConfig = config.platforms[n as keyof typeof config.platforms];
    return platformConfig?.enabled !== false;
  });

  return names.map((n) => ALL_PLATFORMS[n]!());
}

async function heal(platform: Platform, error: unknown): Promise<boolean> {
  const errorClass = platform.classifyError(error);
  switch (errorClass) {
    case "auth_expired":
      if (platform.name === "x") return refreshXCookies();
      if (platform.name === "substack") return refreshSubstackCookies();
      return false;
    case "hash_stale":
      if (platform.name === "x") {
        await refreshHashes();
        return true;
      }
      return false;
    case "rate_limit":
      await new Promise((r) => setTimeout(r, 5000 + Math.random() * 5000));
      return true;
    default:
      return false;
  }
}

export async function publish(
  article: Article,
  opts: PublishOpts & { only?: string[]; exclude?: string[] }
): Promise<PublishResult[]> {
  const platforms = resolvePlatforms(article, opts.only, opts.exclude);

  if (opts.dryRun) {
    const results = await Promise.all(
      platforms.map(async (p) => {
        const dr = await p.dryRun(article);
        return {
          platform: p.name,
          success: true,
          url: undefined,
          error: undefined,
          healed: false,
          dryRun: dr,
        } as PublishResult & { dryRun: unknown };
      })
    );
    return results;
  }

  const results = await Promise.allSettled(
    platforms.map(async (p): Promise<PublishResult> => {
      let result = await p.publish(article, opts);

      if (!result.success) {
        const healed = await heal(p, new Error(result.error));
        if (healed) {
          result = await p.publish(article, opts);
          result.healed = true;
        }
      }

      return result;
    })
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { platform: "unknown", success: false, error: String(r.reason) }
  );
}

export async function doctor(platformName?: string): Promise<Record<string, unknown>[]> {
  const names = platformName ? [platformName] : Object.keys(ALL_PLATFORMS);
  const results = await Promise.all(
    names.map(async (n) => {
      const p = ALL_PLATFORMS[n]!();
      return p.healthCheck();
    })
  );
  return results;
}
