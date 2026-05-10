import { chromium, type BrowserContext } from "playwright";
import { saveCredentials } from "./store.js";

export async function refreshXCookies(): Promise<boolean> {
  return extractCookiesFromBrowser("https://x.com", "x", ["auth_token", "ct0"]);
}

export async function refreshSubstackCookies(): Promise<boolean> {
  return extractCookiesFromBrowser("https://substack.com", "substack");
}

export async function extractCookiesFromBrowser(
  url: string,
  platform: string,
  requiredCookies?: readonly string[]
): Promise<boolean> {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  try {
    const contexts = browser.contexts();
    if (contexts.length === 0) return false;
    const context = contexts[0] as BrowserContext;
    const cookies = await context.cookies(url);
    if (cookies.length === 0) return false;

    if (requiredCookies) {
      const names = new Set(cookies.map((c) => c.name));
      const missing = requiredCookies.filter((n) => !names.has(n));
      if (missing.length > 0) return false;
    }

    saveCredentials(platform, {
      type: "cookie",
      value: JSON.stringify(cookies),
    });
    return true;
  } finally {
    await browser.close();
  }
}
