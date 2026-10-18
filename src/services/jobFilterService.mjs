import { isJobTitleValid, isJobUrlValid, canonicalizeUrl } from "../../jobIdentity.mjs";
import { isLocationFit } from "./locationService.mjs";
import { assessExperienceFit } from "./experienceService.mjs";
import { assessQuickFilter } from "../../scan-evaluate.mjs";

export function getCompanySlugs(company = {}) {
  const baseSlugs = [company.slug, ...(company.slugs || []), ...(company.aliases || []), ...(company.ats_slugs || [])]
    .filter(Boolean)
    .map((slug) => String(slug).trim());
  const generated = baseSlugs.flatMap((slug) => {
    const compact = slug.replace(/[-_\s]+/g, "");
    const dashed = slug.replace(/[_\s]+/g, "-");
    return [slug, compact, dashed];
  });
  return [...new Set(generated.filter(Boolean))];
}

export function companyFailureReason(error) {
  if (!error?.status) return error?.message || "unknown error";
  if (error.status === 404) return "no public board for slug";
  if (error.status === 401 || error.status === 403) return "blocked/auth required";
  if (error.status === 429) return "rate limited";
  return `${error.status}${error.bodyPreview ? ` - ${error.bodyPreview}` : ""}`;
}

export function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function absolutizeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href || null;
  }
}

export function pushIfExperienceFit(results, job, profile, config = {}) {
  if (!job.role || !isJobTitleValid(job.role)) return;
  if (!job.company || job.company.toLowerCase() === "unknown" || job.company.toLowerCase() === "startup") return;
  if (job.url && !isJobUrlValid(job.url)) return;
  if (!isLocationFit(job.location, config)) return;

  const fit = assessExperienceFit(job, profile);
  if (fit.compatible) {
    const canonUrl = canonicalizeUrl(job.url) || job.url || null;
    const cleanLocation =
      job.location && job.location !== "Unknown" && job.location !== "Remote/India"
        ? String(job.location).trim()
        : null;

    const qf = assessQuickFilter(job, config);
    results.push({
      ...job,
      url: canonUrl,
      location: cleanLocation,
      experience_fit: fit.reason,
      min_experience_years: fit.minYears,
      quick_filter: qf.pass ? "pass" : "fail",
      quick_filter_reason: qf.pass ? null : qf.reason,
    });
  }
}

export function resolveActiveSources(config = {}, sourcesArg = "") {
  const allKnownSources = ["greenhouse", "lever", "ashby", "careers_page", "internshala", "naukri", "wellfound"];
  const disabledSources = new Set(
    (config.disabled_sources || ["wellfound", "naukri", "internshala"]).map((s) => s.toLowerCase())
  );
  let sources = allKnownSources.filter((s) => !disabledSources.has(s));

  if (sourcesArg) {
    sources = String(sourcesArg).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return sources;
}
