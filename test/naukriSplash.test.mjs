import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const isOfflineMode = Boolean(
  process.env.TEST_OFFLINE ||
  process.env.SKIP_BROWSER_TESTS ||
  process.env.npm_lifecycle_event === "test:offline"
);

test("Naukri Splash Screen Fixture: Correctly detects Next.js splash state in offline fixture", async (t) => {
  if (isOfflineMode) {
    t.skip("Skipping browser test in offline mode");
    return;
  }
  const fixturePath = path.resolve("./test/fixtures/naukri_splash.html");
  assert.ok(fs.existsSync(fixturePath), "Fixture naukri_splash.html must exist");

  const html = fs.readFileSync(fixturePath, "utf-8");
  assert.ok(html.includes("styles_splScrn__C8kSD"), "Fixture must contain splash screen container");
  assert.ok(html.includes("circleG"), "Fixture must contain animated circle loaders");

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (err) {
    t.skip(`Chromium not available: ${err.message}`);
    return;
  }
  const page = await browser.newPage();
  
  // Abort external network calls so tests run 100% offline and sub-second
  await page.route("**/*", (route) => route.abort());
  await page.setContent(html, { waitUntil: "domcontentloaded" });

  // 1. Verify splash detection evaluates to true
  const isSplashDetected = await page.evaluate(() =>
    Boolean(document.querySelector(".styles_splScrn__C8kSD, .styles_splashscreen-container__jxBax"))
  );
  assert.equal(isSplashDetected, true, "Splash screen must be detected in unhydrated SSR fixture");

  // 2. Verify job cards are not yet mounted in splash state
  const cardCount = await page.evaluate(() =>
    document.querySelectorAll(".srp-jobtuple-wrapper, [data-job-id]").length
  );
  assert.equal(cardCount, 0, "No job cards should be mounted during initial splash screen");

  // 3. Verify title in initial Next.js splash state is empty
  const title = (await page.title()) || "";
  assert.equal(title, "", "Title in initial Next.js splash state is empty");

  await browser.close();
});

test("Naukri DOM Hierarchy: Verifies card wrapper does not duplicate child tuple elements", async (t) => {
  if (isOfflineMode) {
    t.skip("Skipping browser test in offline mode");
    return;
  }
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Naukri Mock</title></head>
      <body>
        <div class="srp-jobtuple-wrapper">
          <div class="cust-job-tuple">
            <a class="title" href="https://www.naukri.com/job-listings-1">Software Engineer</a>
            <div class="comp-name">TechCorp</div>
          </div>
        </div>
        <div class="srp-jobtuple-wrapper">
          <div class="cust-job-tuple">
            <a class="title" href="https://www.naukri.com/job-listings-2">Backend Developer</a>
            <div class="comp-name">DataInc</div>
          </div>
        </div>
      </body>
    </html>
  `;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (err) {
    t.skip(`Chromium not available: ${err.message}`);
    return;
  }
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  await page.setContent(sampleHtml, { waitUntil: "domcontentloaded" });

  // Unique wrapper check
  const uniqueCards = await page.evaluate(() =>
    document.querySelectorAll(".srp-jobtuple-wrapper, [data-job-id]").length
  );
  assert.equal(uniqueCards, 2, "Unique card wrapper must yield 2 cards");

  // Prove why comma child selector duplicated count
  const duplicatedWithChild = await page.evaluate(() =>
    document.querySelectorAll(".srp-jobtuple-wrapper, .cust-job-tuple").length
  );
  assert.equal(duplicatedWithChild, 4, "Selecting parent + child via comma selector yields 4 (double count)");

  await browser.close();
});
