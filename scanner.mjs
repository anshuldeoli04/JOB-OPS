import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import {
  getExperienceProfile,
  loadConfig,
  loadJsonFile,
  SCAN_RESULTS_FILE,
} from "./config-utils.mjs";

const COMPANIES_FILE = "./companies.json";
import { logger } from "./logger.mjs";
import { jobKey, isSameJob } from "./jobIdentity.mjs";
import { HEALTH, FAILING } from "./health.mjs";
import { isLocationFit } from "./src/services/locationService.mjs";
import { verifySources } from "./src/scrapers/sourceVerifier.mjs";
import { displayResults } from "./src/services/scannerDisplay.mjs";
import { createStealthBrowser } from "./src/scrapers/browser/browserLauncher.mjs";
import { GreenhouseScraper } from "./src/scrapers/greenhouse.mjs";
import { LeverScraper } from "./src/scrapers/lever.mjs";
import { AshbyScraper } from "./src/scrapers/ashby.mjs";
import { CareersPageScraper } from "./src/scrapers/browser/careers.mjs";
import { InternshalaScraper } from "./src/scrapers/browser/internshala.mjs";
import { NaukriScraper } from "./src/scrapers/browser/naukri.mjs";
import { WellfoundScraper } from "./src/scrapers/browser/wellfound.mjs";
import { loadScanResultsFromDb, saveScanResultsToDb } from "./src/storage/db.mjs";

export { isLocationFit, verifySources };

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
  const existing = loadScanResultsFromDb();
  const existingKeys = new Set(existing.map((r) => jobKey(r)).filter(Boolean));

  const runKeys = new Set();
  const uniqueRunResults = [];
  for (const record of results) {
    const key = jobKey(record);
    if (!key || runKeys.has(key)) continue;
    runKeys.add(key);
    uniqueRunResults.push(record);
  }

  const newResults = uniqueRunResults.filter((record) => {
    const key = jobKey(record);
    if (existingKeys.has(key) || existing.some((ex) => isSameJob(ex, record))) return false;
    existingKeys.add(key);
    return true;
  });

  const merged = [...existing, ...newResults];
  saveScanResultsToDb(merged, true);

  return {
    added: newResults,
    totalExisting: existing.length,
    skippedWithinRun: results.length - uniqueRunResults.length,
    skippedCrossRun: uniqueRunResults.length - newResults.length,
  };
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

async function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function runScrapers(sources, companies, keywords, config, experienceProfile) {
  const allResults = [];
  const rawBySource = {};
  const filteredBySource = {};
  const healthBySource = {};

  const recordSourceBatch = (sourceName, batch = []) => {
    rawBySource[sourceName] = (rawBySource[sourceName] || 0) + (batch.rawCount != null ? batch.rawCount : batch.length);
    filteredBySource[sourceName] = (filteredBySource[sourceName] || 0) + batch.length;
    healthBySource[sourceName] = batch.healthStatus || (batch.failed ? HEALTH.ERROR : HEALTH.HEALTHY);
    allResults.push(...batch);
  };

  const needsBrowser = sources.some((s) => ["careers_page", "internshala", "naukri", "wellfound"].includes(s));
  let sharedBrowser = null;
  if (needsBrowser) {
    const launched = await createStealthBrowser();
    sharedBrowser = launched.browser;
    await launched.context.close();
  }

  try {
    if (sources.includes("greenhouse")) {
      recordSourceBatch("greenhouse", await new GreenhouseScraper().scan(companies, keywords, config, experienceProfile));
    }
    if (sources.includes("lever")) {
      recordSourceBatch("lever", await new LeverScraper().scan(companies, keywords, config, experienceProfile));
    }
    if (sources.includes("ashby")) {
      recordSourceBatch("ashby", await new AshbyScraper().scan(companies, keywords, config, experienceProfile));
    }
    if (sources.includes("careers_page")) {
      recordSourceBatch("careers_page", await new CareersPageScraper().scan(sharedBrowser, companies, keywords, config, experienceProfile));
    }
    if (sources.includes("internshala")) {
      recordSourceBatch("internshala", await new InternshalaScraper().scan(sharedBrowser, keywords, experienceProfile, config));
    }
    if (sources.includes("naukri")) {
      recordSourceBatch("naukri", await new NaukriScraper().scan(sharedBrowser, keywords, experienceProfile, config));
    }
    if (sources.includes("wellfound")) {
      recordSourceBatch("wellfound", await new WellfoundScraper().scan(sharedBrowser, keywords, experienceProfile, config));
    }
  } finally {
    if (sharedBrowser) {
      try { await sharedBrowser.close(); } catch (err) { logger.warn(`Browser cleanup warning: ${err.message}`); }
    }
  }

  return { allResults, rawBySource, filteredBySource, healthBySource };
}

async function main() {
  console.clear();
  logger.info("============================================================");
  logger.info("        JOB-OPS Scanner");
  logger.info("  Greenhouse API + Lever API + Ashby API + Internshala + Naukri");
  logger.info("============================================================\n");

  const args = process.argv.slice(2);
  const companiesArg = args.find((a) => a.startsWith("--companies="))?.split("=")[1];
  const companies = loadCompanies(companiesArg ? path.resolve(companiesArg) : COMPANIES_FILE);

  if (args.includes("--verify-sources")) {
    await verifySources(companies);
    return;
  }

  const config = loadConfig({ requireApiKey: false });

  const sourceArg = args.find((a) => a.startsWith("--source="))?.split("=")[1];
  const kwArg = args.find((a) => a.startsWith("--keyword="))?.split("=")[1];
  const kwsArg = args.find((a) => a.startsWith("--keywords="))?.split("=")[1];
  const sourcesArg = args.find((a) => a.startsWith("--sources="))?.split("=")[1];
  const expYearsArg = args.find((a) => a.startsWith("--experience-years="))?.split("=")[1];
  const nonInteractive = args.includes("--non-interactive");
  const showFiltered = args.includes("--show-filtered");
  const skipEvaluatePrompt = args.includes("--skip-evaluate-prompt");
  const experienceProfile = getExperienceProfile(config, { experience_years: expYearsArg });

  const defaultKws = config.target_roles?.map((r) => r.toLowerCase()) || [
    "software engineer", "backend engineer", "ai engineer", "machine learning", "full stack"
  ];
  let keywords = kwsArg ? kwsArg.split(",").map((k) => k.trim()).filter(Boolean)
    : kwArg ? [kwArg.trim()].filter(Boolean) : defaultKws;

  let sources = resolveActiveSources(config, sourcesArg || sourceArg);
  logger.info(`Scanning for: ${keywords.join(", ")}`);
  logger.info(`Experience: ${experienceProfile.label}`);
  logger.info(`Sources: ${sources.join(", ")}`);
  logger.info("-".repeat(60));

  const { allResults, rawBySource, filteredBySource, healthBySource } = await runScrapers(
    sources, companies, keywords, config, experienceProfile
  );

  const existingRecords = loadScanResultsFromDb();
  const existingKeys = new Set(existingRecords.map((r) => jobKey(r)).filter(Boolean));
  const funnelStats = {};
  for (const src of sources) {
    funnelStats[src] = {
      raw: rawBySource[src] || 0,
      filtered: filteredBySource[src] || 0,
      withinDedup: 0,
      crossDedup: 0,
      new: 0,
      healthStatus: healthBySource[src] || HEALTH.ERROR,
    };
  }

  const seenInRun = new Set();
  const trulyNewJobs = [];
  for (const record of allResults) {
    const src = record.source || "other";
    if (!funnelStats[src]) funnelStats[src] = { raw: 0, filtered: 0, withinDedup: 0, crossDedup: 0, new: 0 };
    const key = jobKey(record);
    if (!key || seenInRun.has(key)) continue;
    seenInRun.add(key);
    funnelStats[src].withinDedup += 1;

    if (existingKeys.has(key) || existingRecords.some((ex) => isSameJob(ex, record))) {
      funnelStats[src].crossDedup += 1;
    } else {
      existingKeys.add(key);
      funnelStats[src].new += 1;
      trulyNewJobs.push(record);
    }
  }

  if (trulyNewJobs.length > 0) {
    saveScanResultsToDb([...existingRecords, ...trulyNewJobs], true);
  }

  displayResults(trulyNewJobs, funnelStats, showFiltered);
  if (sources.some((src) => FAILING.has(funnelStats[src]?.healthStatus))) {
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
