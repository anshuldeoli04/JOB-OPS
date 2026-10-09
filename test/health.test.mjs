import test from "node:test";
import assert from "node:assert/strict";
import { HEALTH, FAILING, classifyApiSource, classifyBrowserPage } from "../health.mjs";

test("Health V1: API stats {total:16, success:6, noBoard:10} -> DEGRADED", () => {
  const state = classifyApiSource({ total: 16, success: 6, noBoard: 10 });
  assert.strictEqual(state, HEALTH.DEGRADED);
});

test("Health V1: API stats {total:8, success:1, noBoard:7} -> DEGRADED", () => {
  const state = classifyApiSource({ total: 8, success: 1, noBoard: 7 });
  assert.strictEqual(state, HEALTH.DEGRADED);
});

test("Health V1: API stats {total:2, success:2} with 0 matched jobs -> HEALTHY", () => {
  const state = classifyApiSource({ total: 2, success: 2 });
  assert.strictEqual(state, HEALTH.HEALTHY);
});

test("Health V1: API stats {total:5, success:0, rateLimited:5} -> BLOCKED", () => {
  const state = classifyApiSource({ total: 5, success: 0, rateLimited: 5 });
  assert.strictEqual(state, HEALTH.BLOCKED);
});

test("Health V1: API stats {total:5, success:0, noBoard:5} -> ERROR", () => {
  const state = classifyApiSource({ total: 5, success: 0, noBoard: 5 });
  assert.strictEqual(state, HEALTH.ERROR);
});

test("Health V1: Browser {cards:0, rawAnchors:25, title:'Jobs'} -> SELECTOR_BROKEN", () => {
  const state = classifyBrowserPage({ cards: 0, rawAnchors: 25, title: "Jobs" });
  assert.strictEqual(state, HEALTH.SELECTOR_BROKEN);
});

test("Health V1: Browser {cards:3, expectedMinCards:15} -> DEGRADED", () => {
  const state = classifyBrowserPage({ cards: 3, expectedMinCards: 15, title: "Jobs" });
  assert.strictEqual(state, HEALTH.DEGRADED);
});

test("Health V1: Browser {cards:0, title:'', rawAnchors:0} -> BLOCKED", () => {
  const state = classifyBrowserPage({ cards: 0, title: "", rawAnchors: 0 });
  assert.strictEqual(state, HEALTH.BLOCKED);
});

test("Health V1: Browser {title:'Just a moment...'} -> BLOCKED", () => {
  const state = classifyBrowserPage({ title: "Just a moment..." });
  assert.strictEqual(state, HEALTH.BLOCKED);
});

test("Health V1: Browser with word captcha only inside a <script> (not in bodyText) -> not BLOCKED", () => {
  const state = classifyBrowserPage({
    title: "Careers at TechCorp",
    bodyText: "Open Positions: Software Engineer, Product Manager",
    cards: 2,
    rawAnchors: 5,
  });
  assert.notStrictEqual(state, HEALTH.BLOCKED);
  assert.strictEqual(state, HEALTH.HEALTHY);
});

test("Health V1: FAILING set includes BLOCKED, SELECTOR_BROKEN, THROTTLED_TIMEOUT, and ERROR", () => {
  assert.ok(FAILING.has(HEALTH.BLOCKED));
  assert.ok(FAILING.has(HEALTH.SELECTOR_BROKEN));
  assert.ok(FAILING.has(HEALTH.THROTTLED_TIMEOUT));
  assert.ok(FAILING.has(HEALTH.ERROR));
  assert.ok(!FAILING.has(HEALTH.HEALTHY));
  assert.ok(!FAILING.has(HEALTH.DEGRADED));
  assert.ok(!FAILING.has(HEALTH.EMPTY));
  assert.ok(!FAILING.has(HEALTH.SKIPPED));
});

test("Health V1: aggregateHealthStates calculates worst state across queries", async () => {
  const { aggregateHealthStates } = await import("../health.mjs");
  assert.strictEqual(aggregateHealthStates([HEALTH.HEALTHY, HEALTH.HEALTHY]), HEALTH.HEALTHY);
  assert.strictEqual(aggregateHealthStates([HEALTH.HEALTHY, HEALTH.DEGRADED]), HEALTH.DEGRADED);
  assert.strictEqual(aggregateHealthStates([HEALTH.HEALTHY, HEALTH.BLOCKED]), HEALTH.BLOCKED);
  assert.strictEqual(aggregateHealthStates([HEALTH.EMPTY, HEALTH.EMPTY]), HEALTH.EMPTY);
  assert.strictEqual(aggregateHealthStates([HEALTH.HEALTHY, HEALTH.SELECTOR_BROKEN]), HEALTH.SELECTOR_BROKEN);
  assert.strictEqual(aggregateHealthStates([]), HEALTH.SKIPPED);
});

test("Health V4: Selector-broken simulation with 25 job anchors and 0 card wrappers", async (t) => {
  if (process.env.TEST_OFFLINE || process.env.SKIP_BROWSER_TESTS) {
    t.skip("Skipping browser test in offline mode");
    return;
  }
  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch (err) {
    t.skip(`Chromium not available: ${err.message}`);
    return;
  }
  const page = await browser.newPage();
  await page.route("**/*", (r) => r.abort());

  const brokenHtml = `
    <html>
      <head><title>Search Jobs in India</title></head>
      <body>
        <div>
          ${Array.from({ length: 25 }, (_, i) => `<p><a href="/job/swe-${i}">Software Engineer ${i}</a></p>`).join("\n")}
        </div>
      </body>
    </html>
  `;
  await page.setContent(brokenHtml, { waitUntil: "domcontentloaded" });

  const title = await page.title();
  const pageText = await page.locator("body").innerText();
  const domCheck = await page.evaluate(() => {
    const roleRegex = /\b(engineer|developer|designer|manager|analyst|intern|architect|lead|associate|sde)\b/i;
    const anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
      const t = a.textContent.trim();
      const h = a.href || "";
      return t.length > 3 && t.length < 100 && (roleRegex.test(t) || h.includes("job"));
    });
    const cards = document.querySelectorAll(".srp-jobtuple-wrapper, [data-job-id]").length;
    return { rawAnchors: anchors.length, cards };
  });

  const state = classifyBrowserPage({
    title,
    bodyText: pageText,
    rawAnchors: domCheck.rawAnchors,
    cards: domCheck.cards,
    expectedMinCards: 15,
  });

  assert.strictEqual(state, HEALTH.SELECTOR_BROKEN);
  assert.ok(domCheck.rawAnchors >= 25);
  assert.strictEqual(domCheck.cards, 0);

  await browser.close();
});

