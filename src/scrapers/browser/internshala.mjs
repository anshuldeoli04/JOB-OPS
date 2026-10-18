import { BaseScraper } from "../base.mjs";
import { pushIfExperienceFit } from "../../services/jobFilterService.mjs";
import { HEALTH } from "../../../health.mjs";
import { createStealthBrowserFromExisting } from "./browserLauncher.mjs";
import logger from "../../../logger.mjs";

export class InternshalaScraper extends BaseScraper {
  constructor() {
    super("Internshala");
  }

  async scan(browser, keywords, experienceProfile, config) {
    const results = [];
    let totalRaw = 0;
    logger.info(`\nInternshala (stealth scraping)...`);
    let context;
    try {
      ({ context } = await createStealthBrowserFromExisting(browser));
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}", (r) => r.abort());

      for (const kw of keywords) {
        try {
          const searchSlug = `${kw.replace(/\s+/g, "-").toLowerCase()}-jobs`;
          const url = `https://internshala.com/jobs/${searchSlug}/`;
          logger.info(`   Searching "${kw}"...`);

          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await this.randomDelay(2000, 4000);

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
              ".individual_internship",
              ".job_listing",
              "[data-id]",
            ]);
            nodes.forEach((card) => {
              const role = card.querySelector(".job-internship-name a, .profile")?.textContent?.trim();
              const company = card.querySelector(".company_name a, .company-name")?.textContent?.trim();
              const location = card.querySelector(".location_link, .locations span")?.textContent?.trim();
              const href = card.querySelector(".job-internship-name a, .profile")?.href;
              const salary = card.querySelector(".stipend, .salary")?.textContent?.trim();
              if (role && company) results.push({ role, company, location, url: href, salary });
            });
            return { results, selector };
          });

          totalRaw += jobs.results.length;

          jobs.results.forEach((job) => {
            if (!job.company || !job.role) return;
            pushIfExperienceFit(results, {
              source: "internshala",
              company: job.company,
              role: job.role,
              location: job.location || null,
              url: job.url || null,
              salary: job.salary,
              scanned_at: new Date().toISOString(),
              status: "new",
            }, experienceProfile, config);
          });

          if (!jobs.results.length) {
            logger.warn("Internshala returned 0 jobs - selector may have changed.");
          }
          logger.info(`   ${jobs.results.length} jobs found${jobs.selector ? ` via ${jobs.selector}` : ""}`);
          await this.randomDelay(3000, 6000);
        } catch {
          logger.warn("   error scraping");
        }
      }
      await context.close();
    } catch (e) {
      logger.error(`   Internshala error: ${e.message.slice(0, 60)}`);
      if (context) await context.close().catch(() => {});
      results.failed = true;
    }
    const expectedMin = config.expected_min_cards?.internshala || 20;
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
