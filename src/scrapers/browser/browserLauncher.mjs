import fs from "fs";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import UserAgent from "user-agents";

chromium.use(StealthPlugin());

export function shouldDisableBrowserSandbox() {
  return (
    process.env.DISABLE_BROWSER_SANDBOX === "1" ||
    process.env.CI === "true" ||
    process.env.CODESPACES === "true" ||
    fs.existsSync("/.dockerenv")
  );
}

export async function createStealthBrowser() {
  const ua = new UserAgent({ deviceCategory: "desktop" });
  const sandboxArgs = shouldDisableBrowserSandbox()
    ? ["--no-sandbox", "--disable-setuid-sandbox"]
    : [];
  const browser = await chromium.launch({
    headless: true,
    args: [
      ...sandboxArgs,
      "--disable-blink-features=AutomationControlled",
    ],
  });
  const context = await browser.newContext({
    userAgent: ua.toString(),
    viewport: { width: 1366, height: 768 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    extraHTTPHeaders: {
      "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    window.chrome = { runtime: {} };
  });
  return { browser, context };
}

export async function createStealthBrowserFromExisting(browser) {
  const ua = new UserAgent({ deviceCategory: "desktop" });
  const context = await browser.newContext({
    userAgent: ua.toString(),
    viewport: { width: 1366, height: 768 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    extraHTTPHeaders: {
      "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    window.chrome = { runtime: {} };
  });
  return { context };
}
