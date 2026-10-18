import { BaseScraper } from "./base.mjs";
import { isJobTitleValid, isJobUrlValid } from "../../jobIdentity.mjs";
import { isLocationFit } from "../services/locationService.mjs";
import {
  getCompanySlugs,
  companyFailureReason,
  pushIfExperienceFit,
} from "../services/jobFilterService.mjs";
import { passesAutoQuickFilter } from "../../scan-evaluate.mjs";
import logger from "../../logger.mjs";

export class LeverScraper extends BaseScraper {
  constructor() {
    super("Lever");
  }

  async scan(companies, keywords, config, experienceProfile) {
    const results = [];
    const leverCompanies = companies.filter((c) => c.type === "lever");
    const stats = {
      total: leverCompanies.length,
      success: 0,
      matched: 0,
      noBoard: 0,
      blocked: 0,
      rateLimited: 0,
      errors: 0,
      rawCount: 0,
    };
    logger.info(`\nLever API - ${leverCompanies.length} companies`);

    for (const company of leverCompanies) {
      try {
        logger.info(`   ${company.name}...`);
        let jobs = null;
        let usedSlug = null;
        let lastError = null;

        for (const slug of getCompanySlugs(company)) {
          const endpoints = [
            `https://api.lever.co/v0/postings/${slug}?mode=json`,
            `https://jobs.lever.co/${slug}/api/v0/postings?mode=json`,
          ];
          for (const endpoint of endpoints) {
            try {
              jobs = await this.fetchJson(endpoint);
              usedSlug = slug;
              break;
            } catch (error) {
              lastError = error;
              if (error.status && error.status !== 404) break;
            }
          }
          if (jobs || (lastError?.status && lastError.status !== 404)) break;
        }

        if (!jobs) {
          this.recordFailure(stats, lastError);
          logger.warn(`   skip (${companyFailureReason(lastError)}; checked: ${getCompanySlugs(company).join(", ")})`);
          continue;
        }
        stats.success += 1;
        const jobList = Array.isArray(jobs) ? jobs : [];
        stats.rawCount += jobList.length;

        const matched = jobList.filter((job) => {
          const title = (job.text || "").trim();
          if (!isJobTitleValid(title)) return false;
          const jobUrl = job.hostedUrl || job.applyUrl || job.urls?.apply || null;
          if (jobUrl && !isJobUrlValid(jobUrl)) return false;

          const titleLower = title.toLowerCase();
          const kwMatch =
            keywords.some((kw) => titleLower.includes(kw.toLowerCase())) ||
            passesAutoQuickFilter({ role: title }, config);

          const loc =
            job.categories?.location ||
            (Array.isArray(job.categories?.allLocations) ? job.categories.allLocations.join(", ") : "");
          const locMatch = isLocationFit(loc, config);
          return kwMatch && locMatch;
        });

        matched.forEach((job) => {
          pushIfExperienceFit(results, {
            source: "lever",
            company: company.name,
            role: job.text,
            location: job.categories?.location || null,
            url: job.hostedUrl || job.applyUrl || job.urls?.apply || null,
            posted: job.createdAt ? new Date(job.createdAt).toISOString() : null,
            content: JSON.stringify(job),
            scanned_at: new Date().toISOString(),
            status: "new",
          }, experienceProfile, config);
        });
        stats.matched += matched.length;

        logger.info(
          `   ${matched.length} matching${usedSlug !== company.slug ? ` via ${usedSlug}` : ""} (${Array.isArray(jobs) ? jobs.length : 0} total)`
        );
      } catch (error) {
        this.recordFailure(stats, error);
        logger.warn(`   error (${companyFailureReason(error).slice(0, 120)})`);
      }
      await this.randomDelay(300, 800);
    }
    results.healthStatus = this.summarize(stats);
    results.rawCount = stats.rawCount || 0;
    return results;
  }
}
