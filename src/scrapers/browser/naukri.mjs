import { BaseScraper } from "../base.mjs";
import { jobKey } from "../../../jobIdentity.mjs";
import { pushIfExperienceFit } from "../../services/jobFilterService.mjs";
import {
  HEALTH,
  FAILING,
  classifyBrowserPage,
  aggregateHealthStates,
} from "../../../health.mjs";
import { createStealthBrowserFromExisting } from "./browserLauncher.mjs";
import logger from "../../../logger.mjs";

export class NaukriScraper extends BaseScraper {
  constructor() {
    super("Naukri");
  }

  async scan(browser, keywords, experienceProfile, config) {
    const results = [];
    logger.info(`\nNaukri.com (stealth scraping)...`);
    let context;
    try {
      ({ context } = await createStealthBrowserFromExisting(browser));
      const page = await context.newPage();
      page.setDefaultTimeout(35000);
      await page.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2}", (r) => r.abort());

      const maxKeywords = Math.min(config.naukri_max_keywords || 4, keywords.length);
      const targetKeywords = keywords.slice(0, maxKeywords);
      const maxPages = config.naukri_max_pages || 2;
      const locationParam = "india";
      const freshersOnly = experienceProfile.years <= 0 ? "?freshersOnly=true" : "";
      const expectedMinCards = config.expected_min_cards?.naukri || 15;

      const seenNaukriKeys = new Set();
      const queryHealthStates = [];
      let totalRaw = 0;

      for (const rawKw of targetKeywords) {
        const sanitizedKw = rawKw.replace(/[\/\\,]/g, " ").replace(/\s+/g, " ").trim();
        const searchSlug = sanitizedKw.replace(/\s+/g, "-").toLowerCase();

        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          const pageSuffix = pageNum > 1 ? `-${pageNum}` : "";
          const url = `https://www.naukri.com/${encodeURIComponent(searchSlug)}-jobs-in-${locationParam}${pageSuffix}${freshersOnly}`;

          logger.info(`   Searching "${sanitizedKw}" (page ${pageNum}/${maxPages}, ${experienceProfile.label})...`);

          let pageHealth = HEALTH.HEALTHY;
          let attempts = 0;
          let domCheck = { rawAnchors: 0, splashStill: false, cards: 0 };

          while (attempts < 2) {
            attempts++;
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });

            const splashInitial = await page.evaluate(() =>
              Boolean(document.querySelector(".styles_splScrn__C8kSD, .styles_splashscreen-container__jxBax"))
            );
            if (splashInitial) {
              logger.info("   Naukri Next.js splash detected, awaiting client hydration...");
            }

            await page.waitForSelector(".srp-jobtuple-wrapper, [data-job-id]", { timeout: 15000 }).catch(() => null);

            const title = (await page.title().catch(() => "")) || "";
            const pageText = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).toLowerCase();

            domCheck = await page.evaluate(() => {
              const roleRegex = /\b(engineer|developer|designer|manager|analyst|intern|architect|lead|associate|sde)\b/i;
              const anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
                const t = a.textContent.trim();
                const h = a.href || "";
                return t.length > 3 && t.length < 100 && (roleRegex.test(t) || h.includes("job"));
              });
              const splashStill = Boolean(
                document.querySelector(".styles_splScrn__C8kSD, .styles_splashscreen-container__jxBax")
              );
              const cards = document.querySelectorAll(".srp-jobtuple-wrapper, [data-job-id]").length;
              return { rawAnchors: anchors.length, splashStill, cards };
            });

            if (domCheck.splashStill && attempts === 1) {
              logger.info("   Splash screen still present after wait. Retrying once with 4s backoff...");
              await this.randomDelay(4000, 5000);
              continue;
            }

            pageHealth = classifyBrowserPage({
              title,
              bodyText: pageText,
              rawAnchors: domCheck.rawAnchors,
              cards: domCheck.cards,
              splashStill: domCheck.splashStill,
              expectedMinCards,
            });

            if (pageHealth === HEALTH.SELECTOR_BROKEN) {
              logger.error(`   CRITICAL: Naukri SELECTOR_BROKEN! ${domCheck.rawAnchors} job anchors found but 0 card selectors matched.`);
              break;
            } else if (pageHealth === HEALTH.THROTTLED_TIMEOUT) {
              logger.warn("   Naukri THROTTLED_TIMEOUT: Splash screen persisted after retry.");
              break;
            } else if (pageHealth === HEALTH.BLOCKED) {
              logger.warn(`   Naukri BLOCKED: Page returned empty shell or block page. Title: "${title}"`);
              break;
            } else {
              break;
            }
          }

          queryHealthStates.push(pageHealth);

          if (pageHealth === HEALTH.BLOCKED || pageHealth === HEALTH.SELECTOR_BROKEN || pageHealth === HEALTH.THROTTLED_TIMEOUT) {
            break;
          }

          const jobs = await page.evaluate(() => {
            const results = [];
            const cards = document.querySelectorAll(".srp-jobtuple-wrapper, [data-job-id]");
            cards.forEach((card) => {
              const link = card.querySelector("a.title, .title a, .jobTitle a, a[href*='/job-listings-'], a[href*='naukri.com/job-listings']");
              const role = link?.textContent?.trim() || card.querySelector("[title]")?.getAttribute("title")?.trim();
              const company = card.querySelector(".comp-name, .subTitle a, .companyName a, [class*='company']")?.textContent?.trim();
              const location = card.querySelector(".locWdth, .location, [class*='loc']")?.textContent?.trim();
              const salary = card.querySelector(".sal-wrap, .salary, .sal, [class*='salary']")?.textContent?.trim();
              const href = link?.href;
              const exp = card.querySelector(".exp-wrap, .experience, .expwdth, [class*='exp']")?.textContent?.trim();
              if (role) results.push({ role, company, location, salary, href, exp });
            });

            if (!results.length) {
              document.querySelectorAll("a[href*='job-listings'], a[href*='/job-listings-']").forEach((link) => {
                const role = link.textContent?.trim() || link.getAttribute("title")?.trim();
                const card = link.closest("article, section, div");
                const text = card?.textContent?.replace(/\s+/g, " ").trim() || "";
                const company = card?.querySelector(".comp-name, .subTitle a, .companyName a, [class*='company']")?.textContent?.trim();
                const location = card?.querySelector(".locWdth, .location, [class*='loc']")?.textContent?.trim();
                if (role && link.href) results.push({ role, company, location, href: link.href, exp: text.slice(0, 500) });
              });
            }
            return results;
          });

          totalRaw += jobs.length;
          let newInQuery = 0;

          jobs.forEach((job) => {
            if (!job.company || !job.role) return;
            const k = jobKey({ source: "naukri", company: job.company, role: job.role, url: job.href });
            if (k && seenNaukriKeys.has(k)) return;
            if (k) seenNaukriKeys.add(k);

            newInQuery++;
            pushIfExperienceFit(results, {
              source: "naukri",
              company: job.company,
              role: job.role,
              location: job.location || null,
              url: job.href,
              salary: job.salary,
              experience: job.exp,
              scanned_at: new Date().toISOString(),
              status: "new",
            }, experienceProfile, config);
          });

          logger.info(`   ${jobs.length} jobs on page (${newInQuery} unique added)`);
          await this.randomDelay(4000, 6000);
        }
      }

      results.rawCount = totalRaw;
      results.healthStatus = aggregateHealthStates(queryHealthStates);
      if (FAILING.has(results.healthStatus)) {
        results.failed = true;
      }
      logger.info(`   Naukri scan complete: ${totalRaw} raw jobs, ${results.length} filtered, health: ${results.healthStatus}`);
      await context.close();
    } catch (e) {
      logger.error(`   Naukri error: ${e.message.slice(0, 60)}`);
      results.healthStatus = HEALTH.ERROR;
      results.failed = true;
      if (context) await context.close().catch(() => {});
    }
    return results;
  }
}
