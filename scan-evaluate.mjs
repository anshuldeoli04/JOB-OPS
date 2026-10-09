/**
 * JOB-OPS Scan Evaluator
 * Select discovered jobs from scan results and evaluate fit via routed LLM
 * Usage: node scan-evaluate.mjs
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import {
  assessExperienceFit,
  backupIfNeeded,
  buildApplicationKey,
  generateApplicationId,
  getExperienceProfile,
  loadConfig,
  loadCVWithCache,
  loadJsonFile,
  upsertApplication,
  validateEvaluation,
  withFileLockSync,
  writeJsonFileAtomic,
  SCAN_RESULTS_FILE,
} from "./config-utils.mjs";
import { callLLM, QuotaExhaustedError } from "./llm/llmClient.mjs";
import { getCompactCVProfile, buildScanEvaluationPrompt } from "./llm/evalPrompt.mjs";
import { safeJsonParse } from "./llm/jsonUtils.mjs";
import { logLLM } from "./llm/logger.mjs";
import { jobKey, isSameJob } from "./jobIdentity.mjs";

export const PAGE_SIZE = 25;
const SCAN_TABLE_LIMIT = PAGE_SIZE;
const SCAN_TABLE_COLUMNS = {
  serial: 5,
  company: 32,
  title: 54,
  source: 14,
};

export function wrapText(text, width = 60, indent = "          ") {
  if (!text) return "";
  const words = String(text).trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0] === "")) return "";

  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= width) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join(`\n${indent}`);
}

function buildScanResultKey(job = {}) {
  return jobKey(job);
}

function loadScanResults() {
  if (!fs.existsSync(SCAN_RESULTS_FILE)) {
    console.log("scan-results.json not found. Run node scanner.mjs first.");
    process.exit(1);
  }
  return loadJsonFile(SCAN_RESULTS_FILE, {
    fallback: [],
    warnMessage: "Warning: scan-results.json could not be parsed",
  });
}

function truncateCell(value, width) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= width) return normalized.padEnd(width, " ");
  if (width <= 3) return ".".repeat(width);
  return `${normalized.slice(0, width - 3)}...`;
}

function formatSerial(index) {
  return String(index + 1).padStart(2, "0");
}

function buildScanTableRow(index, job) {
  const serial = truncateCell(formatSerial(index), SCAN_TABLE_COLUMNS.serial);
  const company = truncateCell(job.company || "Unknown", SCAN_TABLE_COLUMNS.company);
  const title = truncateCell(job.role || "Unknown", SCAN_TABLE_COLUMNS.title);
  const source = truncateCell(job.source || "manual", SCAN_TABLE_COLUMNS.source);
  return `${serial} | ${company} | ${title} | ${source}`;
}

export function renderJobTable(pageJobs, start = 0) {
  const header = `${"S.No".padEnd(SCAN_TABLE_COLUMNS.serial, " ")} | ${"Company".padEnd(SCAN_TABLE_COLUMNS.company, " ")} | ${"Title".padEnd(SCAN_TABLE_COLUMNS.title, " ")} | ${"Source".padEnd(SCAN_TABLE_COLUMNS.source, " ")}`;
  const separator = "-".repeat(header.length);

  console.log(header);
  console.log(separator);
  pageJobs.forEach((job, index) => {
    console.log(buildScanTableRow(start + index, job));
  });
  console.log(separator);
}

export function displayPage(page, jobs = []) {
  const totalPages = Math.ceil(jobs.length / PAGE_SIZE) || 1;
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, jobs.length);
  const pageJobs = jobs.slice(start, end);

  console.clear();
  console.log(`JOB-OPS Scan Evaluator — Page ${page + 1}/${totalPages} (${jobs.length} total jobs)\n`);

  // Render table for current page jobs
  renderJobTable(pageJobs, start); // S.No should continue from start+1

  console.log(`\n[N] Next Page  [P] Previous Page  [Q] Quit  [1-25] Select job`);
}

function printExperienceMatchedJobs(jobs) {
  displayPage(0, jobs);
}

function mapNumberToIndex(num, currentPage, pageSize, totalJobs) {
  if (num >= 1 && num <= pageSize) {
    const idx = currentPage * pageSize + (num - 1);
    return idx < totalJobs ? idx : null;
  }
  if (num > pageSize && num <= totalJobs) {
    return num - 1;
  }
  return null;
}

export function parseJobSelection(input, currentPage, pageSize, totalJobs) {
  const indices = new Set();
  const tokens = String(input || "").split(",").map((s) => s.trim()).filter(Boolean);

  for (const token of tokens) {
    if (token.includes("-")) {
      const [startRaw, endRaw] = token.split("-").map((s) => parseInt(s.trim(), 10));
      if (!Number.isNaN(startRaw) && !Number.isNaN(endRaw)) {
        const start = Math.min(startRaw, endRaw);
        const end = Math.max(startRaw, endRaw);
        for (let num = start; num <= end; num++) {
          const idx = mapNumberToIndex(num, currentPage, pageSize, totalJobs);
          if (idx !== null) indices.add(idx);
        }
      }
    } else {
      const num = parseInt(token, 10);
      if (!Number.isNaN(num)) {
        const idx = mapNumberToIndex(num, currentPage, pageSize, totalJobs);
        if (idx !== null) indices.add(idx);
      }
    }
  }

  return [...indices].sort((a, b) => a - b);
}

export function markEvaluated(job, status = "evaluated", error = null) {
  return withFileLockSync(SCAN_RESULTS_FILE, () => {
    const results = loadScanResults();
    const targetKey = buildScanResultKey(job);
    const idx = results.findIndex((result) => buildScanResultKey(result) === targetKey || isSameJob(result, job));
    if (idx >= 0) {
      if (status === "evaluated") {
        results[idx].status = "evaluated";
        if (job.content) {
          results[idx].content = job.content;
        }
        delete results[idx].last_error;
      } else if (status === "error" || error) {
        const attempts = Number(results[idx].eval_attempts || 0) + 1;
        results[idx].eval_attempts = attempts;
        results[idx].last_error = String(error?.message || error || "Evaluation failed").slice(0, 200);
        // T-7 #3: Retry up to 3 times across runs; only then mark failed.
        if (attempts >= 3) {
          results[idx].status = "failed";
        } else {
          results[idx].status = "new"; // Remains new for next run retry
        }
      } else {
        results[idx].status = status;
      }
      writeJsonFileAtomic(SCAN_RESULTS_FILE, results, { lock: false });
      return results[idx];
    }
    return null;
  });
}

let activeReadline = null;

function getReadlineInterface() {
  if (!activeReadline || activeReadline.closed) {
    activeReadline = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return activeReadline;
}

async function askQuestion(prompt) {
  const rl = getReadlineInterface();
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => {
      resolve(ans.trim());
    });
  });
}



function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TWO_LETTER_TECH_TOKENS = new Set([
  "ai", "ml", "qa", "ui", "ux", "js", "ts", "go", "ci", "cd", "db", "os", "dl", "cv", "ar", "vr"
]);

export function buildAutoRolePatterns(config) {
  const targetRoles = (config.target_roles || [])
    .map((role) => String(role || "").trim().toLowerCase())
    .filter(Boolean);

  const patterns = [];

  for (const rawRole of targetRoles) {
    const variants = [rawRole];
    // Split compound titles like "AI/ML Engineer" -> ["AI Engineer", "ML Engineer"]
    if (rawRole.includes("/")) {
      const parts = rawRole.split("/").map((p) => p.trim());
      const suffixMatch = rawRole.match(/\/([a-z0-9]+)\s+(.+)$/i);
      if (suffixMatch) {
        const firstPrefix = rawRole.split("/")[0].trim();
        const secondPrefix = suffixMatch[1].trim();
        const suffix = suffixMatch[2].trim();
        variants.push(`${firstPrefix} ${suffix}`);
        variants.push(`${secondPrefix} ${suffix}`);
      }
    }

    for (const variant of variants) {
      const compact = variant.replace(/[^a-z0-9]+/g, " ").trim();
      const tokens = compact
        .split(/\s+/)
        .filter((token) => (token.length > 2 || TWO_LETTER_TECH_TOKENS.has(token)) && !["and", "for", "with", "the", "in"].includes(token));

      if (tokens.length > 0) {
        patterns.push({
          phrasePattern: new RegExp(`\\b${escapeRegExp(compact).replace(/\s+/g, "\\s+")}\\b`, "i"),
          importantTokens: tokens,
        });
      }
    }
  }

  return patterns;
}

export const DEFAULT_ROLE_TERMS = [
  "software engineer",
  "software developer",
  "backend developer",
  "backend engineer",
  "full stack developer",
  "full stack engineer",
  "frontend developer",
  "frontend engineer",
  "web developer",
  "java developer",
  "python developer",
  "golang developer",
  "c++ developer",
  "systems engineer",
  "sde",
  "swe",
  "developer",
  "engineer",
  "programmer",
  "coder",
  "java",
  "spring",
  "backend",
  "full stack",
  "node",
  "react",
  "python",
];

export const DEFAULT_LEVEL_TERMS = [
  "trainee",
  "junior",
  "jr",
  "associate",
  "fresher",
  "intern",
  "internship",
  "entry level",
  "entry-level",
  "graduate",
  "apprentice"
];

export function computePreRankScore(job, config = {}, experienceProfile = { years: 0 }) {
  const title = String(job.role || job.title || "").toLowerCase();
  const location = String(job.location || "").toLowerCase();
  let score = 0.0;

  // 1. Target roles match (+3.0)
  const targetRoles = (config.target_roles || ["Software Engineer", "Java Developer", "Backend Developer", "Full Stack Developer"])
    .map((r) => r.toLowerCase());
  if (targetRoles.some((role) => title.includes(role))) {
    score += 3.0;
  }

  // 2. Role terms match (+2.5)
  const roleTerms = config.role_terms || DEFAULT_ROLE_TERMS;
  if (roleTerms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(title))) {
    score += 2.5;
  }

  // 3. Junior / level marker match (+1.5)
  const levelTerms = config.level_terms || DEFAULT_LEVEL_TERMS;
  if (levelTerms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(title))) {
    score += 1.5;
  }

  // 4. Location match (+1.5)
  const targetLocations = (config.target_locations || ["India", "Remote", "Bengaluru", "Pune", "Hyderabad", "Noida", "Gurugram"])
    .map((l) => l.toLowerCase());
  if (targetLocations.some((loc) => location.includes(loc)) || !location || location.includes("india") || location.includes("remote")) {
    score += 1.5;
  }

  // 5. Source reliability (+1.0 for official ATS, +0.5 for aggregators)
  const source = String(job.source || "").toLowerCase();
  if (["ashby", "greenhouse", "lever"].includes(source)) {
    score += 1.0;
  } else if (["internshala", "naukri"].includes(source)) {
    score += 0.5;
  }

  // 6. Has description / content (+0.5)
  if (job.content && job.content.length > 50) {
    score += 0.5;
  }

  return Math.min(10.0, Number(score.toFixed(1)));
}

export function assessQuickFilter(job, config = {}) {
  const title = String(job.role || job.title || "").toLowerCase();
  if (!title) return { pass: false, reason: "empty_title" };

  // 1. Broad non-software / non-tech keyword blocklist using WORD BOUNDARIES (\b...\b)
  const rejectKeywords = [
    "teacher",
    "professor",
    "faculty",
    "trainer",
    "tutor",
    "counselor",
    "sales",
    "seo",
    "content writer",
    "copywriter",
    "shopify",
    "wordpress",
    "telegram",
    "annotator",
    "data entry",
    "telecaller",
    "call center",
    "bpo",
    "accountant",
    "auditor",
    "civil",
    "mechanical",
    "electrical",
    "hardware",
    "embedded",
    "biotech",
    "nurse",
    "receptionist",
    "driver",
    "security guard",
    "chef",
    "graphic designer",
    "graphics designer",
    "video editor",
    "maths expert",
    "stem trainer",
    "it faculty",
    "pharma",
    "pharmacy",
    "pharmacist",
    "qc",
    "quality control",
    "chemist",
    "retail",
    "store manager",
    "cashier",
    "marketing",
    "business development",
  ];

  for (const kw of rejectKeywords) {
    const rx = new RegExp(`\\b${escapeRegExp(kw).replace(/\\s+/g, "\\s+")}\\b`, "i");
    if (rx.test(title)) {
      return { pass: false, reason: `blocked_keyword:${kw}` };
    }
  }

  // 2. Senior / managerial title patterns
  const seniorPatterns = [
    /\bsenior\b/i,
    /\b(sr\.?|snr)\b/i,
    /\bstaff\b/i,
    /\blead\b/i,
    /\bprincipal\b/i,
    /\bmanager\b/i,
    /\bdirector\b/i,
    /\bhead\b/i,
    /\barchitect\b/i,
    /\bvp\b/i,
    /\bsolutions?\s+architect\b/i,
    /\b(sde[- ]?(?:2|ii|3|iii)|swe[- ]?(?:2|ii|3|iii)|software engineer (?:2|ii|3|iii))\b/i,
    /\b(engineer|developer|sde|mts)\s+(?:2|ii|3|iii|iv)\b/i,
    /\blevel\s+(?:2|ii|3|iii)\b/i,
    /\brecruiter\b/i,
    /\bhr\b/i,
  ];

  for (const pattern of seniorPatterns) {
    if (pattern.test(title)) {
      return { pass: false, reason: `senior_role:${pattern.source}` };
    }
  }

  // 3. Technical discipline blocklist unless explicitly requested in config.target_roles or config.search_profiles
  const targetRolesLower = [
    ...(config.target_roles || []),
    ...(config.search_profiles || config.searchProfiles || []),
  ].join(" ").toLowerCase();

  const disciplineChecks = [
    { key: "support", pattern: /\b(support\s+(engineer|desk|specialist)|customer\s+support|tech(nical)?\s+support|it\s+support|desktop\s+support)\b/i },
    { key: "qa", pattern: /\b(qa\s+(engineer|tester|analyst)|quality\s+assurance|manual\s+tester|test\s+(engineer|lead)|wlan\s+testing)\b/i },
    { key: "devops", pattern: /\b(devops|sre|site\s+reliability|cloud\s+infrastructure|network\s+engineer|system\s+administrator|sysadmin)\b/i },
    { key: "salesforce", pattern: /\b(salesforce\s+(developer|admin|consultant|architect)|salesforce)\b/i },
    { key: "sap", pattern: /\b(sap\b|oracle\s+dba|database\s+administrator)\b/i },
    { key: "security", pattern: /\b(security\s+(engineer|analyst|operations)|soc\s+analyst|cyber\s*security)\b/i },
  ];

  for (const check of disciplineChecks) {
    if (!targetRolesLower.includes(check.key) && check.pattern.test(title)) {
      return { pass: false, reason: `excluded_discipline:${check.key}` };
    }
  }

  // 4. Role Terms vs Level Terms: A title passes ONLY if it matches a role term!
  // Level terms (trainee, intern, associate) NEVER grant a pass on their own!
  const roleTerms = Array.isArray(config.role_terms) && config.role_terms.length > 0
    ? config.role_terms
    : DEFAULT_ROLE_TERMS;

  const matchedRoleTerm = roleTerms.find((term) => {
    const rx = new RegExp(`\\b${escapeRegExp(String(term).toLowerCase()).replace(/\\s+/g, "\\s+")}\\b`, "i");
    return rx.test(title);
  });

  if (!matchedRoleTerm) {
    return { pass: false, reason: "missing_role_term" };
  }

  return { pass: true, reason: null };
}

export function passesAutoQuickFilter(job, config = {}) {
  return assessQuickFilter(job, config).pass;
}

export function isValidJobContent(text) {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 150) return false;

  const lower = trimmed.toLowerCase();
  const boilerplateIndicators = [
    /we use cookies/i,
    /cookie policy/i,
    /accept all cookies/i,
    /please enable javascript/i,
    /access denied/i,
    /just a moment\.\.\./i,
    /verify you are human/i,
    /captcha/i,
    /security service to protect/i,
  ];

  let matches = 0;
  for (const rx of boilerplateIndicators) {
    if (rx.test(lower)) matches++;
  }

  if (trimmed.length < 500 && matches >= 1) return false;
  if (matches >= 2) return false;

  return true;
}

export async function ensureJobContent(job) {
  if (isValidJobContent(job.content)) {
    return job.content;
  }
  if (isValidJobContent(job.description)) {
    job.content = job.description.trim();
    return job.content;
  }
  if (!job.url) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(job.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const html = await resp.text();
      const cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (isValidJobContent(cleaned)) {
        job.content = cleaned.slice(0, 3000);
        return job.content;
      }
    }
  } catch {}
  return null;
}

async function evaluateJob(job, cvCompact, experienceProfile, config) {
  await ensureJobContent(job);
  const prompt = buildScanEvaluationPrompt(job, cvCompact, experienceProfile);
  const response = await callLLM("score_job", [
    {
      role: "system",
      content: "You evaluate Indian tech job fit and must return valid JSON only.",
    },
    {
      role: "user",
      content: prompt,
    },
  ], {
    config,
    temperature: 0.1,
    maxOutputTokens: 1024,
    thinkingBudget: 0,
    responseFormat: { type: "json_object" },
    allowGroqFallback: false,
  });

  if (process.argv.includes("--verbose")) {
    console.log(`[DEBUG usageMetadata]:`, JSON.stringify(response?.usageMetadata || {}));
  }

  if (response?.finishReason === "MAX_TOKENS") {
    const truncErr = new Error("Gemini output truncated: maximum output tokens reached");
    truncErr.kind = "truncated";
    truncErr.status = 400;
    truncErr.provider = response.provider || "gemini";
    throw truncErr;
  }

  const rawText = response?.text || String(response);
  const parsed = safeJsonParse(rawText);
  const hasDescription = isValidJobContent(job.content);

  return validateEvaluation(parsed, {
    company: job.company,
    role: job.role,
    location: job.location,
    provider: response?.provider,
    model: response?.model,
    evaluated_by: response?.provider ? `${response.provider}/${response.model}` : "gemini",
    hasDescription,
    gradeThresholds: config.grade_thresholds,
  });
}

async function main() {
  let config;
  let cv;
  let cvCompact;
  try {
    config = loadConfig();
    cv = loadCVWithCache();
    cvCompact = getCompactCVProfile(cv);
    backupIfNeeded();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1];
  const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const limit = limitArg ? parseInt(limitArg, 10) : null;
  const offsetArg = args.find((a) => a.startsWith("--offset="))?.split("=")[1];
  let offset = offsetArg ? Math.max(0, parseInt(offsetArg, 10) || 0) : 0;
  const nonInteractive = args.includes("--non-interactive");
  const retryErrors = args.includes("--retry-errors") || modeArg === "retry-errors";
  const experienceProfile = getExperienceProfile(config);

  const allResults = loadScanResults();
  const pending = allResults.filter((r) => r.status === "new" || (retryErrors && (r.status === "error" || r.status === "failed")));

  if (pending.length === 0) {
    console.log(
      retryErrors
        ? "No failed or pending jobs found to retry."
        : "All discovered jobs have already been evaluated or none found."
    );
    console.log("Tip: To retry error rows, run: node scan-evaluate.mjs --retry-errors --mode=all\n");
    return;
  }

  const experienceFiltered = pending.filter((job) => assessExperienceFit(job, experienceProfile).compatible);

  if (experienceFiltered.length === 0) {
    console.log(`Discovered ${pending.length} jobs, but none matched ${experienceProfile.label}.`);
    return;
  }

  const jobs = experienceFiltered;
  for (const job of jobs) {
    job.preRankScore = computePreRankScore(job, config, experienceProfile);
  }
  // Sort deterministically by pre-rank score descending
  jobs.sort((a, b) => (b.preRankScore || 0) - (a.preRankScore || 0));

  const totalPages = Math.ceil(jobs.length / PAGE_SIZE) || 1;
  let currentPage = 0;
  let choice = modeArg;
  let toEvaluate = [];

  if (!choice) {
    if (nonInteractive) {
      choice = "all";
    } else {
      while (true) {
        displayPage(currentPage, jobs);
        const input = (await askQuestion("\n> ")).trim();

        if (!input) continue;

        if (input === "n" || input === "N") {
          if (currentPage < totalPages - 1) currentPage++;
        } else if (input === "p" || input === "P") {
          if (currentPage > 0) currentPage--;
        } else if (input === "q" || input === "Q") {
          process.exit(0);
        } else if (input.toLowerCase() === "all" || input.toLowerCase() === "retry-errors") {
          choice = "all";
          break;
        } else if (input.toLowerCase() === "auto") {
          choice = "auto";
          break;
        } else {
          const selectedIndices = parseJobSelection(input, currentPage, PAGE_SIZE, jobs.length);
          if (selectedIndices.length === 0) {
            console.log("No valid selection. Please try again (or press 'q' to quit).");
            await askQuestion("Press Enter to continue...");
            continue;
          }
          toEvaluate = selectedIndices.map((i) => jobs[i]).filter(Boolean);
          break;
        }
      }
    }
  }

  if (choice) {
    if (choice.toLowerCase() === "retry-errors" || choice.toLowerCase() === "all") {
      toEvaluate = jobs;
    } else if (choice.toLowerCase() === "auto") {
      toEvaluate = jobs.filter((job) => passesAutoQuickFilter(job, config));
      console.log(`\nAuto mode: ${toEvaluate.length}/${jobs.length} jobs will be evaluated after title quick-filtering. Only Grade A/B matches will be saved.\n`);
    } else if (toEvaluate.length === 0) {
      const selectedIndices = parseJobSelection(choice, 0, PAGE_SIZE, jobs.length);
      toEvaluate = selectedIndices.map((i) => jobs[i]).filter(Boolean);
    }
  }

  let queueRemaining = 0;
  if (offset > 0) {
    toEvaluate = toEvaluate.slice(offset);
  }
  if (limit && Number.isFinite(limit) && limit > 0) {
    queueRemaining = Math.max(0, toEvaluate.length - limit);
    toEvaluate = toEvaluate.slice(0, limit);
  }

  if (toEvaluate.length === 0) {
    console.log("No valid selection.");
    return;
  }

  const autoMode = choice?.toLowerCase() === "auto";
  console.log(`\n${"=".repeat(70)}`);
  console.log(`BATCH PRE-RANKING: ${toEvaluate.length} candidates selected (offset: ${offset}, limit: ${limit || toEvaluate.length}, queue remaining: ${queueRemaining})`);
  console.log("=".repeat(70));
  toEvaluate.forEach((j, idx) => {
    console.log(`  ${(idx + 1).toString().padStart(2, " ")}. [Score: ${j.preRankScore?.toFixed(1) || "N/A"}] ${j.company} — ${j.role} (${j.source || "web"})`);
  });
  console.log(`${"=".repeat(70)}\n`);

  let saved = 0;
  let failed = 0;

  const evalBudgetMs = Number(process.env.EVAL_TIME_BUDGET_MS || 8 * 60 * 1000);
  const evalStartedAt = Date.now();

  for (let i = 0; i < toEvaluate.length; i++) {
    // T-7 #1: Cooperative time budget checked between jobs
    if (evalBudgetMs > 0 && Date.now() - evalStartedAt >= evalBudgetMs) {
      const pendingCount = toEvaluate.length - i;
      console.log(`\n${"─".repeat(70)}`);
      console.log(`⏰ Time budget reached (${Math.round(evalBudgetMs / 1000)}s). ${pendingCount} jobs still pending (status: "new").`);
      console.log(`${"─".repeat(70)}\n`);
      break;
    }

    const job = toEvaluate[i];
    const current = i + 1;
    const total = toEvaluate.length;
    const company = job.company || "Unknown";
    const title = job.role || "Unknown";

    try {
      const result = await evaluateJob(job, cvCompact, experienceProfile, config);
      const shouldSave = !autoMode || ["A", "B"].includes(result.grade);

      if (shouldSave) {
        const applicationKey = buildApplicationKey({
          company: job.company,
          role: job.role,
          location: job.location,
          url: job.url,
          apply_url: job.url,
        });
        const app = {
          id: generateApplicationId(),
          timestamp: new Date().toISOString(),
          company: job.company,
          role: job.role,
          location: job.location,
          salary_estimate: result.salary_estimate,
          score: result.score,
          grade: result.grade,
          verdict: result.verdict,
          fit_summary: result.fit_summary,
          strengths: result.strengths,
          gaps: result.gaps,
          source: job.source,
          url: job.url,
          apply_url: job.url,
          status: "evaluated",
          evaluated_by: result.evaluated_by || "gemini",
          application_key: applicationKey,
        };
        upsertApplication(app);
        saved++;
      }

      markEvaluated(job);

      const grade = result.grade;
      const score = Number.isFinite(Number(result.score)) ? Number(result.score).toFixed(1) : result.score;
      const action = result.action;

      if (shouldSave) {
        // Saved job
        console.log(`${"─".repeat(70)}`);
        console.log(`[${current}/${total}] ${company} — ${title}`);
        console.log(`  Grade : ${grade}  (${score}/10)  ✓ saved`);
        if (action) console.log(`  Action: ${wrapText(action, 60, "          ")}`);
      } else {
        // Skipped job
        console.log(`${"─".repeat(70)}`);
        console.log(`[${current}/${total}] ${company} — ${title}`);
        console.log(`  Grade : ${grade}  (${score}/10)  ✗ skipped`);
      }
    } catch (error) {
      if (error.name === "QuotaExhaustedError" || error.isQuotaExhausted) {
        console.log(`\n${"─".repeat(70)}`);
        console.log(`[QUOTA EXHAUSTED] ${error.message}`);
        const pendingCount = toEvaluate.length - i;
        console.log(`Remaining ${pendingCount} jobs kept as pending for next run (queue not corrupted).`);
        console.log(`${"─".repeat(70)}\n`);
        break;
      }

      failed++;
      job.eval_attempts = (job.eval_attempts || 0) + 1;
      const isPermanentFail = job.eval_attempts >= 3;
      const updatedRecord = markEvaluated(job, isPermanentFail ? "failed" : "error", error);
      const attempts = updatedRecord?.eval_attempts || job.eval_attempts;
      const finalStatus = updatedRecord?.status || (isPermanentFail ? "failed" : "new");

      console.log(`${"─".repeat(70)}`);
      console.log(`[${current}/${total}] ${company} — ${title}`);
      if (isPermanentFail) {
        console.log(`  ❌ ${company} - ${title}: failed after 3 attempts ([${error.provider || "LLM"}] ${error.message.slice(0, 80)})`);
      } else {
        console.log(`  ⚠️ ${company} - ${title}: attempt ${attempts}/3 failed ([${error.provider || "LLM"}] ${error.message.slice(0, 80)}, status: "${finalStatus}")`);
      }
      logLLM(`[Evaluation Error] [${current}/${total}] ${company} — ${title}:`, error.message);
    }
  }

  if (toEvaluate.length > 0) {
    console.log(`${"─".repeat(70)}`);
  }

  console.log(`\nDone. ${saved} application(s) saved.`);
  if (failed > 0) {
    console.log(`${failed} job(s) failed evaluation; batch continued.`);
  }
  console.log("Run node tracker.mjs to review all tracked applications.\n");

  if (!nonInteractive && queueRemaining > 0) {
    const nextAns = await askQuestion(`${queueRemaining} jobs pending in queue. Evaluate next batch of ${limit || 12}? (y/n): `);
    if (nextAns.toLowerCase() === "y") {
      process.argv = process.argv.filter((a) => !a.startsWith("--offset="));
      process.argv.push(`--offset=${offset + toEvaluate.length}`);
      await main();
      return;
    }
  }

  if (activeReadline) {
    activeReadline.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((err) => {
    console.error("Evaluation script fatal error:", err.message);
    process.exit(1);
  });
}
