/**
 * JOB-OPS Scanner
 * Sources:
 *   - Greenhouse public API (no auth, no scraping)
 *   - Lever public API (no auth, no scraping)
 *   - Internshala (Playwright + stealth, India freshers)
 *   - Naukri (Playwright + stealth, India)
 *   - Wellfound (Playwright + stealth, startups)
 *
 * Usage: node scanner.mjs
 *        node scanner.mjs --sources=greenhouse
 *        node scanner.mjs --keyword "machine learning" --location "bangalore"
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import UserAgent from "user-agents";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import {
  assessExperienceFit,
  getExperienceProfile,
  loadConfig,
  loadJsonFile,
  withFileLockSync,
  writeJsonFileAtomic,
  SCAN_RESULTS_FILE,
  HEALTH_LOG_FILE,
  getDataFilePath,
} from "./config-utils.mjs";
import { logger } from "./logger.mjs";
import {
  canonicalizeUrl,
  jobKey,
  softKey,
  isSameJob,
  isJobUrlValid,
  isJobTitleValid,
} from "./jobIdentity.mjs";
import { passesAutoQuickFilter, assessQuickFilter } from "./scan-evaluate.mjs";
import {
  HEALTH,
  FAILING,
  classifyApiSource,
  classifyBrowserPage,
  aggregateHealthStates,
} from "./health.mjs";

chromium.use(StealthPlugin());

const COMPANIES_FILE = "./companies.json";
const API_FETCH_RETRIES = 2;
const STOCK_API_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

// Non-India countries and macro-regions (comprehensive list)
const NON_INDIA_REGIONS = new Set([
  // Americas
  "us", "usa", "united states", "united states of america",
  "canada", "mexico", "brazil", "argentina", "colombia", "chile", "peru", "uruguay", "costa rica", "panama",
  "americas", "latam", "north america", "south america",
  // Europe
  "uk", "united kingdom", "great britain", "england", "scotland", "wales",
  "ireland", "germany", "france", "netherlands", "spain", "poland", "italy", "portugal",
  "sweden", "norway", "denmark", "finland", "switzerland", "austria", "belgium",
  "czechia", "czech republic", "romania", "bulgaria", "hungary", "greece", "ukraine",
  "estonia", "latvia", "lithuania", "croatia", "serbia", "slovakia", "slovenia",
  "iceland", "cyprus", "malta", "luxembourg", "europe", "emea", "eu",
  // Middle East & Africa
  "israel", "uae", "united arab emirates", "dubai", "abu dhabi", "saudi arabia", "qatar", "bahrain", "kuwait", "oman", "turkey", "egypt",
  "south africa", "nigeria", "kenya", "ghana", "morocco", "africa",
  // Asia-Pacific (non-India)
  "australia", "new zealand", "singapore", "japan", "south korea", "korea", "china", "hong kong", "taiwan",
  "malaysia", "indonesia", "philippines", "thailand", "vietnam"
]);

const DEFAULT_INDIA_ALIASES = [
  "india", "pan india", "work from home", "wfh",
  "bengaluru", "bangalore",
  "gurugram", "gurgaon",
  "delhi", "new delhi", "ncr", "delhi ncr",
  "noida", "greater noida",
  "mumbai", "navi mumbai", "bombay",
  "pune", "maharashtra",
  "hyderabad", "secunderabad", "telangana",
  "chennai", "tamil nadu", "madras",
  "kolkata", "west bengal", "calcutta",
  "ahmedabad", "gujarat",
  "jaipur", "rajasthan",
  "chandigarh", "mohali", "punjab", "haryana",
  "indore", "madhya pradesh",
  "kochi", "cochin", "kerala",
  "karnataka"
];

export function isLocationFit(locStr, config = {}, source = "") {
  // 2.d: Unknown / empty -> accept only for India-specific sources (Naukri, Internshala); reject for global sources
  if (!locStr) {
    const src = String(source || "").toLowerCase();
    return src.includes("naukri") || src.includes("internshala");
  }

  const loc = String(locStr).toLowerCase().replace(/[\/,()_-]/g, " ").replace(/\s+/g, " ").trim();
  if (!loc || loc === "unknown" || loc === "null" || loc === "undefined") {
    const src = String(source || "").toLowerCase();
    return src.includes("naukri") || src.includes("internshala");
  }

  const indiaAliases = Array.isArray(config.india_locations) && config.india_locations.length > 0
    ? config.india_locations.map((a) => a.toLowerCase().trim())
    : DEFAULT_INDIA_ALIASES;

  // 2.a: Contains an India alias -> accept immediately
  const hasIndiaAlias = indiaAliases.some((alias) => {
    const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
    return regex.test(loc);
  });
  if (hasIndiaAlias) {
    return true;
  }

  // 2.b: Contains an explicit non-India signal -> reject
  for (const foreign of NON_INDIA_REGIONS) {
    const regex = new RegExp(`\\b${foreign.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(loc)) {
      return false;
    }
  }

  // 2.c: Plain "Remote" / "Anywhere" / "Worldwide" / "APAC"
  const isPlainRemote = /\b(remote|anywhere|worldwide|global|apac)\b/i.test(loc);
  if (isPlainRemote) {
    const allowUnrestricted = config.allow_unrestricted_remote ?? true;
    return Boolean(allowUnrestricted);
  }

  // Fallback: If not recognized, accept for Indian sources, reject for global sources
  const src = String(source || "").toLowerCase();
  return src.includes("naukri") || src.includes("internshala");
}

function loadCompanies(filePath = COMPANIES_FILE) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} missing. Restore it before running scanner.mjs.`);
  }

  const companies = loadJsonFile(filePath, {
    fallback: null,
    warnMessage: `Warning: ${filePath} could not be parsed`,
  });

  if (!Array.isArray(companies) || companies.length === 0) {
    throw new Error(`${filePath} is empty or invalid. Fix it before running scanner.mjs.`);
  }

  return companies;
}

export function saveScanResults(results) {
  return withFileLockSync(SCAN_RESULTS_FILE, () => {
    const existing = loadJsonFile(SCAN_RESULTS_FILE, {
      fallback: [],
      warnMessage: "Warning: scan-results.json could not be parsed, starting fresh",
    });
    const existingKeys = new Set(existing.map((r) => jobKey(r)).filter(Boolean));

    // Within-run deduplication
    const runKeys = new Set();
    const uniqueRunResults = [];
    for (const record of results) {
      const key = jobKey(record);
      if (!key) continue;
      if (runKeys.has(key)) continue;
      runKeys.add(key);
      uniqueRunResults.push(record);
    }

    // Cross-run deduplication against existing database
    const newResults = uniqueRunResults.filter((record) => {
      const key = jobKey(record);
      if (existingKeys.has(key)) return false;
      if (existing.some((ex) => isSameJob(ex, record))) return false;
      existingKeys.add(key);
      return true;
    });

    const merged = [...existing, ...newResults];
    writeJsonFileAtomic(SCAN_RESULTS_FILE, merged, { lock: false });

    return {
      added: newResults,
      totalExisting: existing.length,
      skippedWithinRun: results.length - uniqueRunResults.length,
      skippedCrossRun: uniqueRunResults.length - newResults.length,
    };
  });
}

function shouldDisableBrowserSandbox() {
  return (
    process.env.DISABLE_BROWSER_SANDBOX === "1" ||
    process.env.CI === "true" ||
    process.env.CODESPACES === "true" ||
    fs.existsSync("/.dockerenv")
  );
}

async function createStealthBrowser() {
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

async function createStealthBrowserFromExisting(browser) {
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

async function randomDelay(min = 1200, max = 3500) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  await new Promise((r) => setTimeout(r, ms));
}

function getCompanySlugs(company = {}) {
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

async function fetchJsonWithStatus(url, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= API_FETCH_RETRIES; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": STOCK_API_USER_AGENT,
        ...(options.headers || {}),
      },
    });

    const body = await response.text();
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText}`);
      error.status = response.status;
      error.bodyPreview = body.slice(0, 180).replace(/\s+/g, " ");
      lastError = error;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === API_FETCH_RETRIES) {
        throw error;
      }
      await randomDelay(1500 * (attempt + 1), 3500 * (attempt + 1));
      continue;
    }

    try {
      return JSON.parse(body);
    } catch (error) {
      error.bodyPreview = body.slice(0, 180).replace(/\s+/g, " ");
      throw error;
    }
  }

  throw lastError || new Error(`Failed to fetch ${url}`);
}

function companyFailureReason(error) {
  if (!error?.status) return error?.message || "unknown error";
  if (error.status === 404) return "no public board for slug";
  if (error.status === 401 || error.status === 403) return "blocked/auth required";
  if (error.status === 429) return "rate limited";
  return `${error.status}${error.bodyPreview ? ` - ${error.bodyPreview}` : ""}`;
}

function pushIfExperienceFit(results, job, profile, config = {}) {
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

function summarizeApiScan(source, stats) {
  const status = classifyApiSource(stats);
  const skipped = stats.noBoard + stats.blocked + stats.rateLimited + stats.errors;
  if (!stats.total) return HEALTH.SKIPPED;
  logger.info(
    `   ${source} summary: ${stats.success}/${stats.total} boards ok [${status}], ${stats.matched} matched, ${skipped} skipped`
  );
  if (stats.success === 0 && skipped === stats.total) {
    logger.warn(`   ${source} systematic failure: check ATS slugs/network/rate limits. Run with updated slugs in companies.json.`);
  }
  return status;
}

function recordApiFailure(stats, error) {
  if (error?.status === 404) stats.noBoard += 1;
  else if (error?.status === 401 || error?.status === 403) stats.blocked += 1;
  else if (error?.status === 429) stats.rateLimited += 1;
  else stats.errors += 1;
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function absolutizeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href || null;
  }
}

async function scanGreenhouse(companies, keywords, config, experienceProfile) {
  const results = [];
  const ghCompanies = companies.filter((c) => c.type === "greenhouse");
  const stats = { total: ghCompanies.length, success: 0, matched: 0, noBoard: 0, blocked: 0, rateLimited: 0, errors: 0 };
  logger.info(`\nGreenhouse API - ${ghCompanies.length} companies`);

  for (const company of ghCompanies) {
    try {
      logger.info(`   ${company.name}...`);
      let data = null;
      let usedSlug = null;
      let lastError = null;

      for (const slug of getCompanySlugs(company)) {
        try {
          data = await fetchJsonWithStatus(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
          usedSlug = slug;
          break;
        } catch (error) {
          lastError = error;
          if (error.status && error.status !== 404) break;
        }
      }

      if (!data) {
        recordApiFailure(stats, lastError);
        logger.warn(`   skip (${companyFailureReason(lastError)}; checked: ${getCompanySlugs(company).join(", ")})`);
        continue;
      }
      stats.success += 1;
      const jobs = data.jobs || [];
      stats.rawCount = (stats.rawCount || 0) + jobs.length;

      const matched = jobs.filter((job) => {
        const title = (job.title || "").trim();
        if (!isJobTitleValid(title)) return false;
        if (job.absolute_url && !isJobUrlValid(job.absolute_url)) return false;

        const titleLower = title.toLowerCase();
        const kwMatch =
          keywords.some((kw) => titleLower.includes(kw.toLowerCase())) ||
          passesAutoQuickFilter({ role: title }, config);

        const locName = job.location?.name || "";
        const locMatch = isLocationFit(locName, config);
        return kwMatch && locMatch;
      });

      matched.forEach((job) => {
        pushIfExperienceFit(results, {
          source: "greenhouse",
          company: company.name,
          role: job.title,
          location: job.location?.name || null,
          url: job.absolute_url,
          posted: job.updated_at,
          content: job.content,
          scanned_at: new Date().toISOString(),
          status: "new",
        }, experienceProfile, config);
      });
      stats.matched += matched.length;

      logger.info(`   ${matched.length} matching jobs${usedSlug !== company.slug ? ` via ${usedSlug}` : ""} (${jobs.length} total)`);
    } catch (e) {
      recordApiFailure(stats, e);
      logger.warn(`   error (${companyFailureReason(e).slice(0, 120)})`);
    }
    await randomDelay(300, 800);
  }
  results.healthStatus = summarizeApiScan("Greenhouse", stats);
  results.rawCount = stats.rawCount || 0;
  return results;
}

async function scanLever(companies, keywords, config, experienceProfile) {
  const results = [];
  const leverCompanies = companies.filter((c) => c.type === "lever");
  const stats = { total: leverCompanies.length, success: 0, matched: 0, noBoard: 0, blocked: 0, rateLimited: 0, errors: 0 };
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
            jobs = await fetchJsonWithStatus(endpoint);
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
        recordApiFailure(stats, lastError);
        logger.warn(`   skip (${companyFailureReason(lastError)}; checked: ${getCompanySlugs(company).join(", ")})`);
        continue;
      }
      stats.success += 1;
      const jobList = Array.isArray(jobs) ? jobs : [];
      stats.rawCount = (stats.rawCount || 0) + jobList.length;

      const matched = jobList.filter((job) => {
        const title = (job.text || "").trim();
        if (!isJobTitleValid(title)) return false;
        const jobUrl = job.hostedUrl || job.applyUrl || job.urls?.apply || null;
        if (jobUrl && !isJobUrlValid(jobUrl)) return false;

        const titleLower = title.toLowerCase();
        const kwMatch =
          keywords.some((kw) => titleLower.includes(kw.toLowerCase())) ||
          passesAutoQuickFilter({ role: title }, config);

        const loc = job.categories?.location || (Array.isArray(job.categories?.allLocations) ? job.categories.allLocations.join(", ") : "");
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

      logger.info(`   ${matched.length} matching${usedSlug !== company.slug ? ` via ${usedSlug}` : ""} (${Array.isArray(jobs) ? jobs.length : 0} total)`);
    } catch (error) {
      recordApiFailure(stats, error);
      logger.warn(`   error (${companyFailureReason(error).slice(0, 120)})`);
    }
    await randomDelay(300, 800);
  }
  results.healthStatus = summarizeApiScan("Lever", stats);
  results.rawCount = stats.rawCount || 0;
  return results;
}

async function scanAshby(companies, keywords, config, experienceProfile) {
  const results = [];
  const ashbyCompanies = companies.filter((c) => c.type === "ashby");
  const stats = { total: ashbyCompanies.length, success: 0, matched: 0, noBoard: 0, blocked: 0, rateLimited: 0, errors: 0 };
  logger.info(`\nAshby API - ${ashbyCompanies.length} companies`);

  for (const company of ashbyCompanies) {
    try {
      logger.info(`   ${company.name}...`);
      let data = null;
      let usedSlug = null;
      let lastError = null;

      for (const slug of getCompanySlugs(company)) {
        try {
          data = await fetchJsonWithStatus(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
          usedSlug = slug;
          break;
        } catch (error) {
          lastError = error;
          if (error.status && error.status !== 404) break;
        }
      }

      if (!data) {
        recordApiFailure(stats, lastError);
        logger.warn(`   skip (${companyFailureReason(lastError)}; checked: ${getCompanySlugs(company).join(", ")})`);
        continue;
      }
      stats.success += 1;
      const jobs = data.jobs || [];
      stats.rawCount = (stats.rawCount || 0) + jobs.length;

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
        const cleanContent = (job.descriptionPlain || job.descriptionHtml || "").trim();
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

      logger.info(`   ${matched.length} matching jobs${usedSlug !== company.slug ? ` via ${usedSlug}` : ""} (${jobs.length} total)`);
    } catch (e) {
      recordApiFailure(stats, e);
      logger.warn(`   error (${companyFailureReason(e).slice(0, 120)})`);
    }
    await randomDelay(300, 800);
  }
  results.healthStatus = summarizeApiScan("Ashby", stats);
  results.rawCount = stats.rawCount || 0;
  return results;
}

async function scanCareersPages(browser, companies, keywords, config, experienceProfile) {
  const results = [];
  const careersCompanies = companies.filter((c) => c.type === "careers_page" && !c.disabled);
  const stats = { total: careersCompanies.length, success: 0, matched: 0, noBoard: 0, blocked: 0, rateLimited: 0, errors: 0 };
  logger.info(`\nCareers pages - ${careersCompanies.length} companies`);
  let context;
  let page;

  try {
    ({ context } = await createStealthBrowserFromExisting(browser));
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.route("**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,mp4,webm}", (route) => route.abort());

    for (const company of careersCompanies) {
      try {
        logger.info(`   ${company.name}...`);
        if (!company.url) {
          stats.noBoard += 1;
          logger.warn("   skip (missing careers URL)");
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
            await randomDelay(800, 1500);
            html = await page.content();
            break;
          } catch (navErr) {
            const isNavError = /navigating|execution context|destroyed/i.test(navErr.message);
            if (isNavError && attempts === 1) {
              logger.info(`   ${company.name}: navigation race detected, waiting for redirect to settle...`);
              await randomDelay(2500, 3500);
              await page.waitForLoadState("domcontentloaded").catch(() => {});
              html = await page.content().catch(() => "");
              if (html) break;
            } else {
              throw navErr;
            }
          }
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

        stats.rawCount = (stats.rawCount || 0) + candidates.length;

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
        recordApiFailure(stats, error);
        logger.warn(`   error (${companyFailureReason(error).slice(0, 120)})`);
      }
      await randomDelay(300, 800);
    }
  } finally {
    if (context) await context.close();
  }

  results.healthStatus = summarizeApiScan("Careers pages", stats);
  results.rawCount = stats.rawCount || 0;
  return results;
}

export async function verifySources(companies) {
  logger.info("\n" + "=".repeat(115));
  logger.info("           JOB-OPS ATS SOURCE & SLUG VERIFICATION");
  logger.info("=".repeat(115) + "\n");

  const results = [];
  const pad = (s, n) => String(s || "").padEnd(n);
  const padNum = (n, w) => String(n != null ? n : "-").padStart(w);

  logger.info(
    `${pad("COMPANY", 20)} | ${pad("CURRENT ATS", 14)} | ${pad("CURRENT SLUG", 22)} | ${pad("FOUND ATS", 12)} | ${pad("DISCOVERED SLUG", 20)} | ${padNum("JOBS", 6)} | STATUS`
  );
  logger.info("-".repeat(115));

  for (const c of companies) {
    if (c.disabled) {
      logger.info(
        `${pad(c.name, 20)} | ${pad(c.type || "-", 14)} | ${pad(c.slug || "-", 22).slice(0, 22)} | ${pad("-", 12)} | ${pad("-", 20)} | ${padNum("-", 6)} | DISABLED (${c.reason || "configured"})`
      );
      results.push({
        company: c.name,
        current_type: c.type,
        current_slug: c.slug || null,
        current_url: c.url || null,
        status: "DISABLED",
        reason: c.reason || "disabled in config",
      });
      continue;
    }

    if (c.type === "careers_page") {
      logger.info(
        `${pad(c.name, 20)} | ${pad("careers_page", 14)} | ${pad(c.url || "-", 22).slice(0, 22)} | ${pad("careers_page", 12)} | ${pad("-", 20)} | ${padNum("-", 6)} | CAREERS_PAGE`
      );
      results.push({
        company: c.name,
        current_type: "careers_page",
        current_url: c.url || null,
        status: "CAREERS_PAGE",
        recommendation: "Scraped via Playwright",
      });
      continue;
    }

    const slugs = [
      c.slug,
      ...(c.slugs || []),
      ...(c.aliases || []),
      c.name.toLowerCase().replace(/[^a-z0-9]/g, ""),
      c.name.toLowerCase().replace(/\s+/g, "-"),
      c.name.toLowerCase().replace(/\s+/g, ""),
    ].filter(Boolean);

    const triedSlugs = [...new Set(slugs)];
    let discovered = null;
    let lastError = null;

    for (const slug of triedSlugs) {
      // Check Greenhouse
      try {
        const gh = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
        if (gh.ok) {
          const d = await gh.json();
          discovered = { ats: "greenhouse", slug, count: d.jobs?.length || 0 };
          break;
        } else if (gh.status !== 404) {
          lastError = { status: gh.status, ats: "greenhouse" };
        }
      } catch (e) {
        lastError = { error: e.message };
      }

      // Check Ashby
      try {
        const ash = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
        if (ash.ok) {
          const d = await ash.json();
          discovered = { ats: "ashby", slug, count: d.jobs?.length || 0 };
          break;
        } else if (ash.status !== 404) {
          lastError = { status: ash.status, ats: "ashby" };
        }
      } catch (e) {
        lastError = { error: e.message };
      }

      // Check Lever
      try {
        const lev = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
        if (lev.ok) {
          const d = await lev.json();
          discovered = { ats: "lever", slug, count: Array.isArray(d) ? d.length : 0 };
          break;
        } else if (lev.status !== 404) {
          lastError = { status: lev.status, ats: "lever" };
        }
      } catch (e) {
        lastError = { error: e.message };
      }
    }

    let status = "SLUG_NOT_FOUND";
    let recommendation = "Verify manual careers URL or mark disabled";

    if (discovered) {
      status = "FOUND";
      if (discovered.ats === c.type && discovered.slug === c.slug) {
        recommendation = "Verified ok";
      } else {
        recommendation = `Update type to "${discovered.ats}" and slug to "${discovered.slug}"`;
      }
    } else if (lastError?.status === 429) {
      status = "RATE_LIMITED";
      recommendation = "Retry later";
    } else if (lastError?.status === 403 || lastError?.status === 401) {
      status = "BLOCKED";
      recommendation = "Blocked or requires authentication";
    } else if (lastError?.error) {
      status = "ERROR";
      recommendation = `Network error: ${lastError.error}`;
    }

    results.push({
      company: c.name,
      current_type: c.type,
      current_slug: c.slug || null,
      tried_slugs: triedSlugs,
      discovered_ats: discovered?.ats || null,
      discovered_slug: discovered?.slug || null,
      job_count: discovered?.count ?? null,
      status,
      recommendation,
    });

    logger.info(
      `${pad(c.name, 20)} | ${pad(c.type, 14)} | ${pad(c.slug || "-", 22).slice(0, 22)} | ${pad(discovered?.ats || "-", 12)} | ${pad(discovered?.slug || "-", 20)} | ${padNum(discovered?.count, 6)} | ${status}`
    );
  }

  logger.info("-".repeat(115) + "\n");
  const outPath = getDataFilePath("verify-sources.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  logger.info(`Results written to: ${outPath}\n`);
}

async function scanInternshala(browser, keywords, experienceProfile, config) {
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
        await randomDelay(2000, 4000);

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
        await randomDelay(3000, 6000);
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

async function scanNaukri(browser, keywords, experienceProfile, config) {
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
      const sanitizedKw = rawKw
        .replace(/[\/\\,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const searchSlug = sanitizedKw.replace(/\s+/g, "-").toLowerCase();

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        // Verified Naukri pagination pattern: https://www.naukri.com/<slug>-jobs-in-india[-<pageNum>][?freshersOnly=true]
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
            await randomDelay(4000, 5000);
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

        // Delay 4-6 seconds between navigations to prevent triggering anti-bot
        await randomDelay(4000, 6000);
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

async function scanWellfound(browser, keywords, experienceProfile, config) {
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
        await randomDelay(2500, 5000);

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
        await randomDelay(4000, 7000);
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
  results.rawCount = totalRaw;
  results.healthStatus = totalRaw > 0 ? HEALTH.HEALTHY : (results.failed ? HEALTH.ERROR : HEALTH.EMPTY);
  return results;
}

function displayResults(newJobs = [], funnelStats = {}, showFiltered = false) {
  const sources = Object.keys(funnelStats);
  if (sources.length > 0) {
    logger.info(`\n${"=".repeat(95)}`);
    logger.info("SCAN FUNNEL BREAKDOWN");
    logger.info("=".repeat(95));
    const pad = (s, w) => String(s || "").padEnd(w);
    const padNum = (n, w) => String(n || 0).padStart(w);

    logger.info(
      `${pad("Source", 15)} | ${pad("Health", 18)} | ${padNum("Raw", 6)} | ${padNum("Filtered", 8)} | ${padNum("Within-Dedup", 12)} | ${padNum("Cross-Dedup", 11)} | ${padNum("NEW", 6)}`
    );
    logger.info("-".repeat(95));

    const totals = { raw: 0, filtered: 0, withinDedup: 0, crossDedup: 0, new: 0 };
    for (const src of sources) {
      const s = funnelStats[src];
      totals.raw += s.raw || 0;
      totals.filtered += s.filtered || 0;
      totals.withinDedup += s.withinDedup || 0;
      totals.crossDedup += s.crossDedup || 0;
      totals.new += s.new || 0;

      const health = s.healthStatus || (logger.warn(`   ${src}: health not reported (bug)`), HEALTH.ERROR);

      logger.info(
        `${pad(src, 15)} | ${pad(health, 18)} | ${padNum(s.raw, 6)} | ${padNum(s.filtered, 8)} | ${padNum(s.withinDedup, 12)} | ${padNum(s.crossDedup, 11)} | ${padNum(s.new, 6)}`
      );

      try {
        const logEntry = JSON.stringify({
          ts: new Date().toISOString(),
          source: src,
          state: health,
          raw: s.raw || 0,
          filtered: s.filtered || 0,
        });
        fs.appendFileSync(HEALTH_LOG_FILE, logEntry + "\n", "utf8");
      } catch (err) {
        logger.warn(`Could not append to health-log.jsonl: ${err.message}`);
      }
    }
    logger.info("-".repeat(95));
    logger.info(
      `${pad("TOTAL", 15)} | ${pad("-", 18)} | ${padNum(totals.raw, 6)} | ${padNum(totals.filtered, 8)} | ${padNum(totals.withinDedup, 12)} | ${padNum(totals.crossDedup, 11)} | ${padNum(totals.new, 6)}`
    );
    logger.info("=".repeat(95));
  }

  const visibleJobs = showFiltered ? newJobs : newJobs.filter((j) => j.quick_filter !== "fail");
  const filteredCount = newJobs.length - visibleJobs.length;

  if (visibleJobs.length === 0 && newJobs.length === 0) {
    logger.info("\n0 new jobs found (all were duplicates or previously scanned).");
    return;
  }

  logger.info(`\n${"=".repeat(75)}`);
  if (filteredCount > 0 && !showFiltered) {
    logger.info(`${visibleJobs.length} NEW JOBS FOUND (${filteredCount} non-target/filtered hidden, use --show-filtered to view)`);
  } else {
    logger.info(`${visibleJobs.length} NEW JOBS FOUND`);
  }
  logger.info("=".repeat(75));

  const bySource = {};
  visibleJobs.forEach((r) => {
    if (!bySource[r.source]) bySource[r.source] = [];
    bySource[r.source].push(r);
  });

  Object.entries(bySource).forEach(([source, jobs]) => {
    logger.info(`\n${source.toUpperCase()} (${jobs.length})`);
    jobs.forEach((job, i) => {
      logger.info(`   ${i + 1}. ${job.role} @ ${job.company}`);
      logger.info(`      ${job.location || "Location not specified"}${job.salary ? " | " + job.salary : ""}`);
      if (job.url) logger.info(`      ${job.url}`);
    });
  });

  logger.info(`\n${"=".repeat(75)}`);
  logger.info(`Saved to: ${SCAN_RESULTS_FILE}`);
  logger.info(`\nTo evaluate any discovered job:`);
  logger.info(`   node evaluate.mjs       (paste Job Description or URL)`);
  logger.info(`   node scan-evaluate.mjs  (select from scan results)\n`);
}

async function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export function resolveActiveSources(config = {}, sourcesArg = "") {
  const allKnownSources = ["greenhouse", "lever", "ashby", "careers_page", "internshala", "naukri", "wellfound"];
  const disabledSources = new Set((config.disabled_sources || ["wellfound", "naukri", "internshala"]).map((s) => s.toLowerCase()));
  let sources = allKnownSources.filter((s) => !disabledSources.has(s));

  if (sourcesArg) {
    sources = String(sourcesArg).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return sources;
}

async function main() {
  console.clear();
  logger.info("============================================================");
  logger.info("        JOB-OPS Scanner");
  logger.info("  Greenhouse API + Lever API + Ashby API + Internshala + Naukri");
  logger.info("============================================================\n");

  const args = process.argv.slice(2);
  const config = loadConfig();
  const companiesArg = args.find((a) => a.startsWith("--companies="))?.split("=")[1];
  const companiesPath = companiesArg ? path.resolve(companiesArg) : COMPANIES_FILE;
  const companies = loadCompanies(companiesPath);

  if (args.includes("--verify-sources")) {
    await verifySources(companies);
    return;
  }
  const sourceArg = args.find((a) => a.startsWith("--source="))?.split("=")[1];
  const kwArg = args.find((a) => a.startsWith("--keyword="))?.split("=")[1];
  const kwsArg = args.find((a) => a.startsWith("--keywords="))?.split("=")[1];
  const sourcesArg = args.find((a) => a.startsWith("--sources="))?.split("=")[1];
  const experienceYearsArg = args.find((a) => a.startsWith("--experience-years="))?.split("=")[1];
  const nonInteractive = args.includes("--non-interactive");
  const showFiltered = args.includes("--show-filtered");
  const skipEvaluatePrompt = args.includes("--skip-evaluate-prompt");
  const experienceProfile = getExperienceProfile(config, { experience_years: experienceYearsArg });

  const defaultKws = config.target_roles?.map((r) => r.toLowerCase()) || [
    "software engineer",
    "backend engineer",
    "ai engineer",
    "machine learning",
    "full stack",
  ];

  let keywords;
  if (kwsArg) {
    keywords = kwsArg.split(",").map((k) => k.trim()).filter(Boolean);
  } else if (kwArg) {
    keywords = [kwArg.trim()].filter(Boolean);
  } else {
    logger.info(`Current keywords: ${defaultKws.slice(0, 4).join(", ")}`);
    if (nonInteractive) {
      keywords = defaultKws;
    } else {
      const custom = await askQuestion('Custom keywords? (Press Enter to use defaults, or enter custom e.g. "python developer"): ');
      keywords = custom ? custom.split(",").map((k) => k.trim()).filter(Boolean) : defaultKws;
    }
  }

  if (!keywords || keywords.length === 0) {
    keywords = defaultKws;
  }

  let sources = resolveActiveSources(config, sourcesArg || sourceArg);
  if (sourceArg && !sourcesArg) {
    logger.warn("`--source=` is deprecated. Use `--sources=` instead.");
  } else if (!sourcesArg && !sourceArg && !nonInteractive) {
    logger.info("\nSources:");
    logger.info("   1. Default active sources (Greenhouse + Lever + Ashby + Careers pages)");
    logger.info("   2. APIs only (Greenhouse + Lever + Ashby) - fast, no browser needed");
    logger.info("   3. India portals (Internshala + Naukri) - stealth browser");
    logger.info("   4. Custom (type: greenhouse,lever,ashby,careers_page,internshala,naukri,wellfound)");
    const choice = await askQuestion("\nChoice (1/2/3/4): ");
    if (choice === "2") sources = ["greenhouse", "lever", "ashby"];
    else if (choice === "3") sources = ["internshala", "naukri"];
    else if (choice === "4") {
      const custom = await askQuestion("Sources (comma separated): ");
      sources = custom.split(",").map((s) => s.trim());
    }
  }

  logger.info(`\nScanning for: ${keywords.join(", ")}`);
  logger.info(`Experience: ${experienceProfile.label}`);
  logger.info(`Sources: ${sources.join(", ")}`);
  logger.info("-".repeat(60));

  const allResults = [];
  const rawBySource = {};
  const filteredBySource = {};
  const healthBySource = {};

  const recordSourceBatch = (sourceName, batch = []) => {
    rawBySource[sourceName] = (rawBySource[sourceName] || 0) + (batch.rawCount != null ? batch.rawCount : batch.length);
    filteredBySource[sourceName] = (filteredBySource[sourceName] || 0) + batch.length;
    if (batch.healthStatus) {
      healthBySource[sourceName] = batch.healthStatus;
    } else if (batch.failed) {
      healthBySource[sourceName] = HEALTH.ERROR;
    } else {
      healthBySource[sourceName] = HEALTH.ERROR;
      logger.warn(`   ${sourceName}: health not reported (bug)`);
    }
    allResults.push(...batch);
  };

  const needsBrowser = sources.some((source) => ["careers_page", "internshala", "naukri", "wellfound"].includes(source));
  let sharedBrowser = null;

  if (needsBrowser) {
    const launched = await createStealthBrowser();
    sharedBrowser = launched.browser;
    await launched.context.close();
  }

  try {
    if (sources.includes("greenhouse")) {
      const r = await scanGreenhouse(companies, keywords, config, experienceProfile);
      recordSourceBatch("greenhouse", r);
    }
    if (sources.includes("lever")) {
      const r = await scanLever(companies, keywords, config, experienceProfile);
      recordSourceBatch("lever", r);
    }
    if (sources.includes("ashby")) {
      const r = await scanAshby(companies, keywords, config, experienceProfile);
      recordSourceBatch("ashby", r);
    }
    if (sources.includes("careers_page")) {
      const r = await scanCareersPages(sharedBrowser, companies, keywords, config, experienceProfile);
      recordSourceBatch("careers_page", r);
    }
    if (sources.includes("internshala")) {
      const r = await scanInternshala(sharedBrowser, keywords, experienceProfile, config);
      recordSourceBatch("internshala", r);
    }
    if (sources.includes("naukri")) {
      const r = await scanNaukri(sharedBrowser, keywords, experienceProfile, config);
      recordSourceBatch("naukri", r);
    }
    if (sources.includes("wellfound")) {
      const r = await scanWellfound(sharedBrowser, keywords, experienceProfile, config);
      recordSourceBatch("wellfound", r);
    }
  } finally {
    if (sharedBrowser) {
      try {
        await sharedBrowser.close();
      } catch (error) {
        logger.warn(`Browser cleanup warning: ${error.message}`);
      }
    }
  }

  // Load existing records for cross-run dedup
  const existingRecords = loadJsonFile(SCAN_RESULTS_FILE, { fallback: [] });
  const existingKeys = new Set(existingRecords.map((r) => jobKey(r)).filter(Boolean));

  const funnelStats = {};
  for (const src of sources) {
    let health = healthBySource[src];
    if (!health) {
      health = HEALTH.ERROR;
      logger.warn(`   ${src}: health not reported (bug)`);
    }
    funnelStats[src] = {
      raw: rawBySource[src] || 0,
      filtered: filteredBySource[src] || 0,
      withinDedup: 0,
      crossDedup: 0,
      new: 0,
      healthStatus: health,
    };
  }

  const seenInRun = new Set();
  const trulyNewJobs = [];

  for (const record of allResults) {
    const src = record.source || "other";
    if (!funnelStats[src]) {
      funnelStats[src] = { raw: 0, filtered: 0, withinDedup: 0, crossDedup: 0, new: 0 };
    }
    const key = jobKey(record);
    if (!key || seenInRun.has(key)) {
      continue;
    }
    seenInRun.add(key);
    funnelStats[src].withinDedup += 1;

    const isDuplicate = existingKeys.has(key) || existingRecords.some((ex) => isSameJob(ex, record));
    if (isDuplicate) {
      funnelStats[src].crossDedup += 1;
    } else {
      existingKeys.add(key);
      funnelStats[src].new += 1;
      trulyNewJobs.push(record);
    }
  }

  if (trulyNewJobs.length > 0) {
    withFileLockSync(SCAN_RESULTS_FILE, () => {
      const currentDisk = loadJsonFile(SCAN_RESULTS_FILE, { fallback: [] });
      writeJsonFileAtomic(SCAN_RESULTS_FILE, [...currentDisk, ...trulyNewJobs], { lock: false });
    });
  }

  displayResults(trulyNewJobs, funnelStats, showFiltered);

  const hasFailingState = sources.some((src) => FAILING.has(funnelStats[src]?.healthStatus));
  if (hasFailingState) {
    process.exitCode = 2;
  }

  if (trulyNewJobs.length > 0 && !skipEvaluatePrompt && !nonInteractive) {
    const evaluate = await askQuestion(`\nDiscovered ${trulyNewJobs.length} new jobs. Evaluate them now? (y/n): `);
    if (evaluate.toLowerCase() === "y") {
      const { spawn } = await import("child_process");
      spawn("node", ["scan-evaluate.mjs"], { stdio: "inherit" });
    }
  }
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  main().catch((e) => {
    logger.error(`Scanner error: ${e.message}`);
    process.exit(1);
  });
}

