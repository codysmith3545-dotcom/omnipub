import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getConfigDir } from "../core/config.js";

const OPS_PATH = join(getConfigDir(), "x-ops.json");

export type XOperationHashes = {
  ArticleEntityDraftCreate: string;
  ArticleEntityDelete: string;
  ArticleEntitiesSlice: string;
  ArticleEntityPublish: string;
  ArticleEntityUnpublish: string;
  ArticleEntityUpdateContent: string;
  ArticleEntityUpdateCoverMedia: string;
  ArticleEntityUpdateTitle: string;
  refreshedAt: string;
};

const OPERATION_NAMES = [
  "ArticleEntityDraftCreate",
  "ArticleEntityDelete",
  "ArticleEntitiesSlice",
  "ArticleEntityPublish",
  "ArticleEntityUnpublish",
  "ArticleEntityUpdateContent",
  "ArticleEntityUpdateCoverMedia",
  "ArticleEntityUpdateTitle",
] as const;

export function loadHashes(): XOperationHashes | null {
  if (!existsSync(OPS_PATH)) return null;
  const raw = readFileSync(OPS_PATH, "utf-8").trim();
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !("refreshedAt" in parsed)) return null;
  return parsed as XOperationHashes;
}

export function saveHashes(hashes: XOperationHashes): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(OPS_PATH, JSON.stringify(hashes, null, 2));
}

export async function refreshHashes(): Promise<XOperationHashes> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const captured = new Map<string, string>();

    page.on("request", (req) => {
      const url = req.url();
      const match = url.match(/\/i\/api\/graphql\/([^/]+)\/(\w+)/);
      if (match) {
        const [, hash, opName] = match;
        if (hash && opName && (OPERATION_NAMES as readonly string[]).includes(opName)) {
          captured.set(opName, hash);
        }
      }
    });

    await page.goto("https://x.com/i/articles", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    try {
      await page.click('[data-testid="new-article-button"]', { timeout: 3000 });
      await page.waitForTimeout(3000);
    } catch {
      // Button may not exist or be named differently
    }

    const hashes: Record<string, string> = {};
    for (const op of OPERATION_NAMES) {
      const hash = captured.get(op);
      if (hash) hashes[op] = hash;
    }

    const result: XOperationHashes = {
      ...hashes,
      refreshedAt: new Date().toISOString(),
    } as XOperationHashes;

    saveHashes(result);
    return result;
  } finally {
    await browser.close();
  }
}

export function isStaleError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("404") || error.message.includes("no such operation");
  }
  return false;
}
