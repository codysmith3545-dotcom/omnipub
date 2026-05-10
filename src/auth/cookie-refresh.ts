import { chromium, type BrowserContext } from "playwright";
import { saveCredentials } from "./store.js";

export async function refreshXCookies(): Promise<boolean> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("https://x.com", { waitUntil: "networkidle" });
    const cookies = await context.cookies();
    const authCookies = cookies.filter(
      (c) => c.name === "auth_token" || c.name === "ct0"
    );
    if (authCookies.length < 2) return false;

    saveCredentials("x", {
      type: "cookie",
      value: JSON.stringify(cookies),
    });
    return true;
  } finally {
    await browser.close();
  }
}

export async function refreshSubstackCookies(): Promise<boolean> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("https://substack.com", { waitUntil: "networkidle" });
    const cookies = await context.cookies();
    if (cookies.length === 0) return false;

    saveCredentials("substack", {
      type: "cookie",
      value: JSON.stringify(cookies),
    });
    return true;
  } finally {
    await browser.close();
  }
}

export async function extractCookiesFromBrowser(
  url: string,
  platform: string
): Promise<boolean> {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  try {
    const contexts = browser.contexts();
    if (contexts.length === 0) return false;
    const context = contexts[0] as BrowserContext;
    const cookies = await context.cookies(url);
    if (cookies.length === 0) return false;

    saveCredentials(platform, {
      type: "cookie",
      value: JSON.stringify(cookies),
    });
    return true;
  } finally {
    await browser.close();
  }
}
