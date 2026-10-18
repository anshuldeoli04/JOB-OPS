import { BaseScraper } from "../base.mjs";
import { pushIfExperienceFit } from "../../services/jobFilterService.mjs";
import { HEALTH } from "../../../health.mjs";
import { createStealthBrowserFromExisting } from "./browserLauncher.mjs";
import logger from "../../../logger.mjs";

export class WellfoundScraper extends BaseScraper {
  constructor() {
    super("Wellfound");
  }

  async scan(browser, keywords, experienceProfile, config) {
    const results = [];
    let totalRaw = 0;
    logger.info(`\nWellfound (startups, stealth)...`);
    let context;
    try {
      ({ context } = await createStealthBrowserFromExisting(browser));
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2}", (r) => r.abort());

      for (const kw of keywords) {
        try {
          const sanitizedKw = kw.replace(/\//g, " ").replace(/\s+/g, " ").trim();
          const url = `https://wellfound.com/jobs?q=${encodeURIComponent(sanitizedKw)}&l=India&remote=true`;
          logger.info(`   "${sanitizedKw}"...`);
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
          await page.waitForLoadState("domcontentloaded");
          await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
          await page.waitForSelector(
            '[data-test="StartupResult"], .styles_result__r7Tcf, [data-testid="startup-result"], a[href*="/jobs/"]',
            { timeout: 12000 }
          ).catch(() => {});
          await this.randomDelay(2500, 5000);

          const title = await page.title();
          const pageText = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).toLowerCase();
          if (pageText.includes("sign in") && pageText.includes("continue")) {
            logger.warn(`   login wall likely active - title: ${title.slice(0, 80)}`);
          }

          const jobs = await page.evaluate(() => {
            const querySelectorAllWithFallback = (selectors) => {
              for (const selector of selectors) {
                const nodes = document.querySelectorAll(selector);
                if (nodes.length) return { nodes, selector };
              }
              return { nodes: [], selector: null };
            };
            const results = [];
            const { nodes, selector } = querySelectorAllWithFallback([
              '[data-test="StartupResult"]',
              '.styles_result__r7Tcf',
              '[data-testid="startup-result"]',
              '[data-testid*="job"]',
              'section',
            ]);
            nodes.forEach((card) => {
              const company = card.querySelector('[data-test="startup-name"], h2')?.textContent?.trim();
              card.querySelectorAll('[data-test="JobListing"], .styles_listing__HCFJe, a[href*="/jobs/"]').forEach((listing) => {
                const link = listing.matches?.("a") ? listing : listing.querySelector("a");
                const role = link?.textContent?.trim();
                const href = link?.href;
                const location = listing.querySelector(".styles_location__SJ1qB")?.textContent?.trim();
                const salary = listing.querySelector(".styles_compensation__CVvxR")?.textContent?.trim();
                if (role) results.push({ company, role, location, href, salary });
              });
            });
            document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
              try {
                const parsed = JSON.parse(script.textContent || "{}");
                const items = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] || [])];
                items.filter((item) => item["@type"] === "JobPosting").forEach((item) => {
                  results.push({
                    company: item.hiringOrganization?.name,
                    role: item.title,
                    location: item.jobLocation?.address?.addressLocality || item.applicantLocationRequirements?.name,
                    href: item.url,
                    salary: item.baseSalary?.value?.value || item.baseSalary?.value?.minValue,
                  });
                });
              } catch {}
            });
            if (!results.length) {
              document.querySelectorAll('a[href*="/jobs/"], a[href*="/job/"]').forEach((link) => {
                const role = link.textContent?.replace(/\s+/g, " ").trim();
                const card = link.closest("article, section, div");
                const cardText = card?.textContent?.replace(/\s+/g, " ").trim() || "";
                const company =
                  card?.querySelector('[data-test="startup-name"], [data-testid*="company"], h2, h3')?.textContent?.trim() ||
                  cardText.split(role || "")[0]?.trim();
                if (role && link.href && role.length < 140) {
                  results.push({
                    company,
                    role,
                    location: /remote/i.test(cardText) ? "Remote" : "",
                    href: link.href,
                    salary: cardText.match(/₹[^·|]+|\$[^·|]+/)?.[0],
                  });
                }
              });
            }
            return { results, selector };
          });

          totalRaw += jobs.results.length;

          jobs.results.forEach((job) => {
            if (!job.company || job.company.toLowerCase() === "startup" || !job.role) return;
            pushIfExperienceFit(results, {
              source: "wellfound",
              company: job.company,
              role: job.role,
              location: job.location || null,
              url: job.href,
              salary: job.salary,
              scanned_at: new Date().toISOString(),
              status: "new",
            }, experienceProfile, config);
          });

          if (!jobs.results.length) {
            logger.warn(`Wellfound returned 0 jobs - selector changed, JS delayed, anti-bot, or login wall. title="${title.slice(0, 80)}" url=${page.url()}`);
          }
          logger.info(`   ${jobs.results.length} found${jobs.selector ? ` via ${jobs.selector}` : ""}`);
          await this.randomDelay(4000, 7000);
        } catch (error) {
          logger.warn(`   error (${error.message.slice(0, 80)})`);
        }
      }
      await context.close();
    } catch (e) {
      logger.error(`   Wellfound error: ${e.message.slice(0, 60)}`);
      if (context) await context.close().catch(() => {});
      results.failed = true;
    }
    const expectedMin = config.expected_min_cards?.wellfound || 15;
    if (totalRaw >= expectedMin) {
      results.healthStatus = HEALTH.HEALTHY;
    } else if (totalRaw > 0) {
      results.healthStatus = HEALTH.DEGRADED;
    } else if (results.failed) {
      results.healthStatus = HEALTH.ERROR;
    } else {
      results.healthStatus = HEALTH.EMPTY;
    }
    results.rawCount = totalRaw;
    return results;
  }
}
