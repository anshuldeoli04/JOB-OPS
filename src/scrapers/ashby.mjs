import { BaseScraper } from "./base.mjs";
import { isJobTitleValid, isJobUrlValid } from "../../jobIdentity.mjs";
import { isLocationFit } from "../services/locationService.mjs";
import {
  getCompanySlugs,
  companyFailureReason,
  pushIfExperienceFit,
  stripHtml,
} from "../services/jobFilterService.mjs";
import { passesAutoQuickFilter } from "../../scan-evaluate.mjs";
import logger from "../../logger.mjs";

export class AshbyScraper extends BaseScraper {
  constructor() {
    super("Ashby");
  }

  async scan(companies, keywords, config, experienceProfile) {
    const results = [];
    const ashbyCompanies = companies.filter((c) => c.type === "ashby");
    const stats = {
      total: ashbyCompanies.length,
      success: 0,
      matched: 0,
      noBoard: 0,
      blocked: 0,
      rateLimited: 0,
      errors: 0,
      rawCount: 0,
    };
    logger.info(`\nAshby API - ${ashbyCompanies.length} companies`);

    for (const company of ashbyCompanies) {
      try {
        logger.info(`   ${company.name}...`);
        let data = null;
        let usedSlug = null;
        let lastError = null;

        for (const slug of getCompanySlugs(company)) {
          try {
            data = await this.fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
            usedSlug = slug;
            break;
          } catch (error) {
            lastError = error;
            if (error.status && error.status !== 404) break;
          }
        }

        if (!data) {
          this.recordFailure(stats, lastError);
          logger.warn(`   skip (${companyFailureReason(lastError)}; checked: ${getCompanySlugs(company).join(", ")})`);
          continue;
        }
        stats.success += 1;
        const jobs = data.jobs || [];
        stats.rawCount += jobs.length;

        const matched = jobs.filter((job) => {
          const title = (job.title || "").trim();
          if (!isJobTitleValid(title)) return false;
          const jobUrl = job.applyUrl || job.jobUrl;
          if (jobUrl && !isJobUrlValid(jobUrl)) return false;

          const titleLower = title.toLowerCase();
          const kwMatch =
            keywords.some((kw) => titleLower.includes(kw.toLowerCase())) ||
            passesAutoQuickFilter({ role: title }, config);

          const locName = job.location || (job.isRemote ? "Remote" : "");
          const locMatch = isLocationFit(locName, config);
          return kwMatch && locMatch;
        });

        matched.forEach((job) => {
          const cleanContent = (job.descriptionPlain || stripHtml(job.descriptionHtml) || "").trim();
          pushIfExperienceFit(results, {
            source: "ashby",
            company: company.name,
            role: job.title,
            location: job.location || (job.isRemote ? "Remote" : null),
            url: job.applyUrl || job.jobUrl || null,
            posted: job.publishedAt ? new Date(job.publishedAt).toISOString() : null,
            content: cleanContent || JSON.stringify(job),
            scanned_at: new Date().toISOString(),
            status: "new",
          }, experienceProfile, config);
        });
        stats.matched += matched.length;

        logger.info(
          `   ${matched.length} matching jobs${usedSlug !== company.slug ? ` via ${usedSlug}` : ""} (${jobs.length} total)`
        );
      } catch (e) {
        this.recordFailure(stats, e);
        logger.warn(`   error (${companyFailureReason(e).slice(0, 120)})`);
      }
      await this.randomDelay(300, 800);
    }
    results.healthStatus = this.summarize(stats);
    results.rawCount = stats.rawCount || 0;
    return results;
  }
}
