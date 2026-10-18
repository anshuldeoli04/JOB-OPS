import { BaseScraper } from "../base.mjs";
import { isJobTitleValid, isJobUrlValid, jobKey } from "../../../jobIdentity.mjs";
import { isLocationFit } from "../../services/locationService.mjs";
import {
  companyFailureReason,
  pushIfExperienceFit,
} from "../../services/jobFilterService.mjs";
import { passesAutoQuickFilter } from "../../../scan-evaluate.mjs";
import { classifyBrowserPage } from "../../../health.mjs";
import { createStealthBrowserFromExisting } from "./browserLauncher.mjs";
import { validateSafeUrl } from "../../utils/urlValidator.mjs";
import logger from "../../../logger.mjs";

export class CareersPageScraper extends BaseScraper {
  constructor() {
    super("Careers pages");
  }

  async scan(browser, companies, keywords, config, experienceProfile) {
    const results = [];
    const careersCompanies = companies.filter((c) => c.type === "careers_page" && !c.disabled);
    const stats = {
      total: careersCompanies.length,
      success: 0,
      matched: 0,
      noBoard: 0,
      blocked: 0,
      rateLimited: 0,
      errors: 0,
      rawCount: 0,
    };
    logger.info(`\nCareers pages - ${careersCompanies.length} companies`);
    let context;
    let page;

    try {
      ({ context } = await createStealthBrowserFromExisting(browser));
      page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        if (/\.(png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|mp4|webm)(\?.*)?$/i.test(reqUrl)) {
          return route.abort();
        }
        if (route.request().isNavigationRequest()) {
          const check = await validateSafeUrl(reqUrl);
          if (!check.safe) {
            logger.warn(`   [SSRF] Aborted unsafe navigation to ${reqUrl}: ${check.reason}`);
            return route.abort("blockedbyclient");
          }
        }
        return route.continue();
      });

      for (const company of careersCompanies) {
        try {
          logger.info(`   ${company.name}...`);
          if (!company.url) {
            stats.noBoard += 1;
            logger.warn("   skip (missing careers URL)");
            continue;
          }

          // SSRF protection
          const urlCheck = await validateSafeUrl(company.url);
          if (!urlCheck.safe) {
            stats.blocked += 1;
            logger.warn(`   skip unsafe URL (${urlCheck.reason})`);
            continue;
          }

          let response = null;
          let attempts = 0;
          let html = "";

          while (attempts < 2) {
            attempts++;
            try {
              response = await page.goto(company.url, { waitUntil: "domcontentloaded", timeout: 25000 });
              await page.waitForLoadState("domcontentloaded");
              await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
              await page.waitForSelector(
                '[data-job-listing], .job-card, .posting, [data-qa="job-card"], .job-item, .career-item, [class*="job"], [class*="career"], [class*="position"], article, li',
                { timeout: 8000 }
              ).catch(() => null);
              await this.randomDelay(800, 1500);
              html = await page.content();
              break;
            } catch (navErr) {
              const isNavError = /navigating|execution context|destroyed/i.test(navErr.message);
              if (isNavError && attempts === 1) {
                logger.info(`   ${company.name}: navigation race detected, waiting for redirect to settle...`);
                await this.randomDelay(2500, 3500);
                await page.waitForLoadState("domcontentloaded").catch(() => {});
                html = await page.content().catch(() => "");
                if (html) break;
              } else {
                throw navErr;
              }
            }
          }

          const finalUrl = page.url();
          const finalCheck = await validateSafeUrl(finalUrl);
          if (!finalCheck.safe) {
            stats.blocked += 1;
            logger.warn(`   skip unsafe redirected URL (${finalCheck.reason})`);
            continue;
          }

          const status = response?.status() || 200;
          if (status >= 400) {
            const error = new Error(`${status} ${response?.statusText() || ""}`.trim());
            error.status = status;
            throw error;
          }

          stats.success += 1;
          const renderedCandidates = await page.evaluate(() => {
            const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
            const roleWords = /\b(engineer|developer|software|data|machine learning|ml|ai|analyst|product|designer|intern|graduate|sde|frontend|backend|fullstack|devops|cloud|security)\b/i;
            return [...document.querySelectorAll("a[href]")]
              .map((anchor) => {
                const text = normalize(anchor.textContent);
                const href = anchor.href;
                const card = anchor.closest("li, article, section, div");
                const content = normalize(card?.textContent || text);
                return { role: text, location: "Unknown", url: href, content };
              })
              .filter((item) => item.role && item.role.length <= 140 && roleWords.test(`${item.role} ${item.content}`));
          });
          const candidates = [...renderedCandidates];

          const jsonMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
          for (const match of jsonMatches) {
            try {
              const parsed = JSON.parse(match[1].trim());
              const items = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] || [])];
              items.filter((item) => item["@type"] === "JobPosting").forEach((item) => {
                candidates.push({
                  role: item.title,
                  location: Array.isArray(item.jobLocation)
                    ? item.jobLocation.map((loc) => loc.address?.addressLocality || loc.address?.addressRegion || loc.address?.addressCountry).filter(Boolean).join(", ")
                    : item.jobLocation?.address?.addressLocality || item.applicantLocationRequirements?.name,
                  url: item.url || company.url,
                  content: JSON.stringify(item),
                });
              });
            } catch {}
          }

          stats.rawCount += candidates.length;

          let companyHost = "";
          try { companyHost = new URL(company.url).hostname; } catch {}

          const seen = new Set();
          const matched = candidates.filter((job) => {
            if (!job.role || !isJobTitleValid(job.role)) return false;
            const jobUrl = job.url || company.url;
            if (!jobUrl || !isJobUrlValid(jobUrl, { baseHost: companyHost, source: "careers_page" })) return false;

            const key = jobKey({ url: jobUrl, company: company.name, role: job.role, location: job.location });
            if (seen.has(key)) return false;
            seen.add(key);

            const titleLower = job.role.toLowerCase();
            const kwMatch =
              keywords.some((kw) => titleLower.includes(kw.toLowerCase())) ||
              passesAutoQuickFilter({ role: job.role }, config);

            const locMatch = isLocationFit(job.location, config);
            return kwMatch && locMatch;
          });

          matched.forEach((job) => {
            pushIfExperienceFit(results, {
              source: "careers_page",
              company: company.name,
              role: job.role,
              location: job.location && job.location !== "Unknown" ? job.location : null,
              url: job.url || company.url,
              content: job.content,
              scanned_at: new Date().toISOString(),
              status: "new",
            }, experienceProfile, config);
          });

          stats.matched += matched.length;

          const title = (await page.title().catch(() => "")) || "";
          const bodyText = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).toLowerCase();
          const companyHealth = classifyBrowserPage({
            httpStatus: status,
            title,
            bodyText,
            rawAnchors: candidates.length,
            cards: matched.length,
            expectedMinCards: 1,
          });

          logger.info(`   ${company.name}: [${companyHealth}] ${matched.length} matching jobs (${candidates.length} candidates)`);
        } catch (error) {
          this.recordFailure(stats, error);
          logger.warn(`   error (${companyFailureReason(error).slice(0, 120)})`);
        }
        await this.randomDelay(300, 800);
      }
    } finally {
      if (context) await context.close();
    }

    results.healthStatus = this.summarize(stats);
    results.rawCount = stats.rawCount || 0;
    return results;
  }
}
