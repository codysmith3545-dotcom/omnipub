import type { Article, Platform, PublishResult, PublishOpts, HealthStatus } from "../platforms/base.js";
import { XArticlesPlatform } from "../platforms/x-articles.js";
import { LinkedInPlatform } from "../platforms/linkedin.js";
import { MediumPlatform } from "../platforms/medium.js";
import { SubstackPlatform } from "../platforms/substack.js";
import { refreshXCookies, refreshSubstackCookies } from "../auth/cookie-refresh.js";
import { refreshHashes } from "../healing/x-hash-refresh.js";
import { loadConfig } from "./config.js";

const VALID_PLATFORMS = ["x", "linkedin", "medium", "substack"] as const;
type PlatformName = (typeof VALID_PLATFORMS)[number];

const PLATFORM_FACTORIES: Record<PlatformName, () => Platform> = {
  x: () => new XArticlesPlatform(),
  linkedin: () => new LinkedInPlatform(),
  medium: () => new MediumPlatform(),
  substack: () => new SubstackPlatform(),
};

function isValidPlatform(name: string): name is PlatformName {
  return (VALID_PLATFORMS as readonly string[]).includes(name);
}

function resolvePlatforms(article: Article, only?: readonly string[], exclude?: readonly string[]): Platform[] {
  const config = loadConfig();
  let names: string[] = [...VALID_PLATFORMS];

  if (article.platforms && article.platforms.length > 0) {
    names = names.filter((n) => article.platforms!.includes(n));
  }
  if (only && only.length > 0) {
    for (const o of only) {
      if (!isValidPlatform(o)) throw new Error(`Unknown platform: ${o}. Valid: ${VALID_PLATFORMS.join(", ")}`);
    }
    names = names.filter((n) => only.includes(n));
  }
  if (exclude && exclude.length > 0) {
    names = names.filter((n) => !exclude.includes(n));
  }

  names = names.filter((n) => {
    const platformConfig = config.platforms[n as keyof typeof config.platforms];
    return platformConfig?.enabled !== false;
  });

  return names.map((n) => PLATFORM_FACTORIES[n as PlatformName]());
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
        (platform as XArticlesPlatform).invalidateHashes();
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
  opts: PublishOpts & { only?: readonly string[]; exclude?: readonly string[] }
): Promise<PublishResult[]> {
  const platforms = resolvePlatforms(article, opts.only, opts.exclude);

  if (platforms.length === 0) {
    return [{ platform: "none", success: false, error: "No platforms matched filters" }];
  }

  if (opts.dryRun) {
    return Promise.all(
      platforms.map(async (p) => {
        const dr = await p.dryRun(article);
        return {
          platform: p.name,
          success: true,
          dryRun: dr,
        } satisfies PublishResult & { dryRun: unknown };
      })
    );
  }

  const results = await Promise.allSettled(
    platforms.map(async (p): Promise<PublishResult> => {
      try {
        const result = await p.publish(article, opts);

        if (!result.success) {
          const healed = await heal(p, new Error(result.error));
          if (healed) {
            const retry = await p.publish(article, opts);
            retry.healed = true;
            return retry;
          }
        }

        return result;
      } catch (error) {
        const healed = await heal(p, error);
        if (healed) {
          try {
            const retry = await p.publish(article, opts);
            retry.healed = true;
            return retry;
          } catch (retryError) {
            return { platform: p.name, success: false, error: retryError instanceof Error ? retryError.message : String(retryError) };
          }
        }
        return { platform: p.name, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    })
  );

  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { platform: platforms[i]?.name ?? "unknown", success: false, error: String(r.reason) }
  );
}

export async function doctor(platformName?: string): Promise<HealthStatus[]> {
  if (platformName && !isValidPlatform(platformName)) {
    throw new Error(`Unknown platform: ${platformName}. Valid: ${VALID_PLATFORMS.join(", ")}`);
  }
  const names = platformName ? [platformName] : [...VALID_PLATFORMS];
  return Promise.all(names.map((n) => PLATFORM_FACTORIES[n as PlatformName]().healthCheck()));
}
