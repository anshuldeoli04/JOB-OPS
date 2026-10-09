import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalizeUrl, jobKey, softKey, isSameJob } from "./jobIdentity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname);

const CONFIG_FILES = [path.resolve(REPO_ROOT, "config.local.json"), path.resolve(REPO_ROOT, "config.json")];
const ENV_FILES = [path.resolve(REPO_ROOT, ".env.local"), path.resolve(REPO_ROOT, ".env")];
const PLACEHOLDER_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
export const JOB_OPS_DATA_DIR = process.env.JOB_OPS_DATA_DIR
  ? path.resolve(process.env.JOB_OPS_DATA_DIR)
  : path.resolve(REPO_ROOT, "data");
export const APPLICATIONS_FILE = path.resolve(JOB_OPS_DATA_DIR, "applications.json");
export const USAGE_FILE = path.resolve(JOB_OPS_DATA_DIR, "usage.json");
export const BREAKER_FILE = path.resolve(JOB_OPS_DATA_DIR, "breaker.json");
export const SCAN_RESULTS_FILE = path.resolve(JOB_OPS_DATA_DIR, "scan-results.json");
export const HEALTH_LOG_FILE = path.resolve(JOB_OPS_DATA_DIR, "health-log.jsonl");
export const CV_FILE = path.resolve(REPO_ROOT, "cv.md");
export const GEMINI_QUOTA_TIME_ZONE = "America/Los_Angeles";

export function getDataDir() {
  return process.env.JOB_OPS_DATA_DIR
    ? path.resolve(process.env.JOB_OPS_DATA_DIR)
    : path.resolve(REPO_ROOT, "data");
}

export function getDataFilePath(filename) {
  return path.resolve(getDataDir(), filename);
}

const PLACEHOLDER_RE = /\[\[[^\]\n]{2,80}\]\]/;

function loadEnvFiles() {
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      const normalizedValue = rawValue.replace(/^['"]|['"]$/g, "");
      process.env[key] = normalizedValue;
    }
  }
}

loadEnvFiles();

export function saveEnvUpdates(updates = {}, filePath = path.resolve(REPO_ROOT, ".env")) {
  withFileLockSync(filePath, () => {
    let existingLines = [];
    if (fs.existsSync(filePath)) {
      existingLines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    }

    const updateKeys = new Set(Object.keys(updates));
    const retainedLines = existingLines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return true;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return true;
      const k = trimmed.slice(0, eq).trim();
      return !updateKeys.has(k);
    });

    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) {
        retainedLines.push(`${k}=${v}`);
      }
    }

    const newContent = `${retainedLines.filter((l, i, arr) => i < arr.length - 1 || l.trim()).join("\n").trim()}\n`;
    const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, newContent, "utf8");
    try {
      fs.renameSync(tempFile, filePath);
    } catch {
      let renamed = false;
      for (let i = 0; i < 10; i++) {
        try {
          syncSleep(20);
          fs.renameSync(tempFile, filePath);
          renamed = true;
          break;
        } catch {}
      }
      if (!renamed) {
        fs.copyFileSync(tempFile, filePath);
        try { fs.unlinkSync(tempFile); } catch {}
      }
    }
  });

  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined && v !== null) process.env[k] = String(v);
  }
}

function readFirstExistingJson(paths) {
  for (const file of paths) {
    if (fs.existsSync(file)) {
      try {
        return {
          file,
          value: JSON.parse(fs.readFileSync(file, "utf8")),
        };
      } catch (error) {
        throw new Error(`Could not parse ${file}: ${error.message}`);
      }
    }
  }
  return null;
}

export function loadJsonFile(filePath, { fallback = null, warnMessage } = {}) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (warnMessage) {
      console.warn(`${warnMessage}: ${error.message}`);
    }
    return fallback;
  }
}

export async function withFileLock(filePath, callback, { timeoutMs = 10000, retryMs = 50, staleLockMs = 30000 } = {}) {
  const resolvedPath = path.resolve(filePath);
  await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
  const lockPath = `${resolvedPath}.lock`;
  const startedAt = Date.now();
  let handle = null;

  while (!handle) {
    try {
      handle = await fs.promises.open(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const lockStat = await fs.promises.stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > staleLockMs) {
          await fs.promises.unlink(lockPath).catch(() => {});
          continue;
        }
      } catch (lockError) {
        if (lockError.code !== "ENOENT") throw lockError;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for lock on ${filePath}`);
      }
      // Non-blocking async sleep — yields to Node.js event loop
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }

  try {
    await handle.writeFile(String(process.pid));
    return await callback(resolvedPath);
  } finally {
    if (handle) await handle.close();
    try {
      await fs.promises.unlink(lockPath);
    } catch {}
  }
}

export function syncSleep(ms) {
  if (!ms || ms <= 0) return;
  try {
    const sab = new SharedArrayBuffer(4);
    const int32 = new Int32Array(sab);
    Atomics.wait(int32, 0, 0, ms);
  } catch {
    const start = Date.now();
    while (Date.now() - start < ms) {}
  }
}

export function withFileLockSync(filePath, callback, { timeoutMs = 10000, retryMs = 50, staleLockMs = 30000 } = {}) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const lockPath = `${resolvedPath}.lock`;
  const startedAt = Date.now();
  let handle = null;

  while (!handle) {
    try {
      handle = fs.openSync(lockPath, "wx");
    } catch (error) {
      // On Windows, concurrent open attempts or pending deletions throw EPERM or EBUSY alongside EEXIST
      if (error.code !== "EEXIST" && error.code !== "EPERM" && error.code !== "EBUSY") throw error;
      try {
        const lockStat = fs.statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > staleLockMs) {
          try { fs.unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch (lockError) {
        if (lockError.code !== "ENOENT" && lockError.code !== "EPERM" && lockError.code !== "EBUSY") throw lockError;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for lock on ${filePath}`);
      }
      const jitter = Math.floor(Math.random() * 15);
      syncSleep(retryMs + jitter);
    }
  }

  try {
    fs.writeFileSync(handle, String(process.pid));
    return callback(resolvedPath);
  } finally {
    try { fs.closeSync(handle); } catch {}
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  }
}

function writeJsonFileAtomicUnlocked(filePath, value) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tmpPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  try {
    fs.renameSync(tmpPath, resolvedPath);
  } catch (err) {
    if (process.platform === "win32" && (err.code === "EPERM" || err.code === "EBUSY")) {
      let renamed = false;
      for (let i = 0; i < 5; i++) {
        try {
          syncSleep(10);
          fs.renameSync(tmpPath, resolvedPath);
          renamed = true;
          break;
        } catch {}
      }
      if (!renamed) {
        throw new Error(`Failed to atomically rename ${tmpPath} to ${resolvedPath}: ${err.message}`);
      }
    } else {
      throw err;
    }
  }
}

export function writeJsonFileAtomic(filePath, value, { lock = true } = {}) {
  if (!lock) {
    writeJsonFileAtomicUnlocked(filePath, value);
    return;
  }
  withFileLockSync(filePath, () => writeJsonFileAtomicUnlocked(filePath, value));
}

export function getConfigPaths() {
  return [...CONFIG_FILES];
}

export function getPlaceholderApiKey() {
  return PLACEHOLDER_API_KEY;
}

export function sanitizeFileStem(value, fallback = "report") {
  const normalized = String(value || "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function isPlaceholderCv(content) {
  if (!content || typeof content !== "string" || content.trim().length < 200) {
    return true;
  }
  return PLACEHOLDER_RE.test(content);
}

export function buildApplicationKey(application) {
  return jobKey(application);
}

function addIdentity(identities, value, lowercase = false) {
  const normalized = String(value || "").trim();
  if (!normalized) return;
  identities.add(lowercase ? normalized.toLowerCase() : normalized);
}

export function buildApplicationIdentitySet(application = {}) {
  const identities = new Set();
  const rawUrl = application?.apply_url || application?.url || "";
  const canon = canonicalizeUrl(rawUrl);
  const composite = softKey(application?.company, application?.role, application?.location);

  addIdentity(identities, application.application_key, true);
  if (composite) addIdentity(identities, composite, true);
  if (canon) addIdentity(identities, `url:${canon}`, true);
  if (rawUrl) addIdentity(identities, `url:${rawUrl.trim().toLowerCase()}`, true);

  const legacyId = String(application?.id || "").trim();
  if (legacyId.startsWith("job:") || legacyId.startsWith("url:")) {
    addIdentity(identities, legacyId, true);
  }

  return identities;
}

export function applicationsMatch(left = {}, right = {}) {
  return isSameJob(left, right);
}

export function generateApplicationId() {
  return randomUUID();
}

export function loadApplications() {
  return loadJsonFile(APPLICATIONS_FILE, {
    fallback: [],
    warnMessage: "Warning: applications.json is corrupt or unreadable, starting fresh",
  });
}

export function saveApplications(applications = []) {
  writeJsonFileAtomic(APPLICATIONS_FILE, applications);
}

export function upsertApplication(application = {}) {
  return withFileLockSync(APPLICATIONS_FILE, () => {
    const apps = loadApplications();
    const appWithKey = {
      ...application,
      application_key: application.application_key || buildApplicationKey(application),
    };
    const existingIndex = apps.findIndex((existing) => applicationsMatch(existing, appWithKey));
    if (existingIndex >= 0) {
      apps[existingIndex] = { ...apps[existingIndex], ...appWithKey };
    } else {
      apps.push(appWithKey);
    }
    writeJsonFileAtomic(APPLICATIONS_FILE, apps, { lock: false });
    return appWithKey;
  });
}

export function readBreakerState() {
  const fallback = {
    gemini: { until: 0, why: "" },
    groq: { until: 0, why: "" },
  };
  return (
    loadJsonFile(BREAKER_FILE, {
      fallback,
      warnMessage: "Warning: breaker.json could not be parsed, resetting breaker state",
    }) || fallback
  );
}

export function writeBreakerState(state) {
  return withFileLockSync(BREAKER_FILE, () => {
    writeJsonFileAtomicUnlocked(BREAKER_FILE, state);
    return state;
  });
}

export function readGeminiUsage() {
  return loadJsonFile(USAGE_FILE, {
    fallback: {},
    warnMessage: "Warning: usage.json could not be parsed, resetting usage counters",
  });
}

export function getGeminiUsageDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: GEMINI_QUOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getGeminiUsageStats(dayOverride = null) {
  const day = dayOverride || getGeminiUsageDay();
  const usage = readGeminiUsage();
  const entry = usage[day];
  if (entry && typeof entry === "object") {
    return {
      total: Number(entry.total ?? entry.success ?? 0),
      success: Number(entry.success ?? entry.total ?? 0),
      failed: Number(entry.failed ?? 0),
    };
  }
  const count = Number(entry || 0);
  return { total: count, success: count, failed: 0 };
}

export function getGeminiUsageCount(dayOverride = null, { countType = "success" } = {}) {
  const stats = getGeminiUsageStats(dayOverride);
  if (countType === "success") return stats.success;
  if (countType === "failed") return stats.failed;
  return stats.total;
}

export function trackGeminiCall(dayOverride = null, { success = true } = {}) {
  const today = dayOverride || getGeminiUsageDay();
  return withFileLockSync(USAGE_FILE, () => {
    const usage = readGeminiUsage();
    if (!usage[today] || typeof usage[today] !== "object") {
      const prev = Number(usage[today] || 0);
      usage[today] = { total: prev, success: prev, failed: 0 };
    }
    usage[today].total = (usage[today].total || 0) + 1;
    if (success) {
      usage[today].success = (usage[today].success || 0) + 1;
    } else {
      usage[today].failed = (usage[today].failed || 0) + 1;
    }
    writeJsonFileAtomic(USAGE_FILE, usage, { lock: false });
    return usage[today].total;
  });
}

export function backupIfNeeded() {
  const today = new Date().toISOString().split("T")[0];
  const backupFile = path.resolve(REPO_ROOT, `data/backups/applications_${today}.json`);
  if (!fs.existsSync(APPLICATIONS_FILE) || fs.existsSync(backupFile)) {
    return null;
  }

  const resolvedBackup = path.resolve(backupFile);
  fs.mkdirSync(path.dirname(resolvedBackup), { recursive: true });
  fs.copyFileSync(APPLICATIONS_FILE, resolvedBackup);
  return resolvedBackup;
}

export const DEFAULT_GRADE_THRESHOLDS = Object.freeze({ A: 8.0, B: 6.5, C: 5.0, D: 3.5 });

export function gradeFromScore(score, t = DEFAULT_GRADE_THRESHOLDS) {
  const num = Number(score);
  if (!Number.isFinite(num)) return "C";
  const thresholds = t || DEFAULT_GRADE_THRESHOLDS;
  if (num >= (thresholds.A ?? 8.0)) return "A";
  if (num >= (thresholds.B ?? 6.5)) return "B";
  if (num >= (thresholds.C ?? 5.0)) return "C";
  if (num >= (thresholds.D ?? 3.5)) return "D";
  return "F";
}

function normalizeScore(score) {
  const parsed = Number(score);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(10, Math.max(1, Math.round(parsed * 10) / 10));
}

export function validateEvaluation(raw = {}, context = {}) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const provider = safe.provider || context.provider || "gemini";
  const model = safe.model || context.model || "";
  const evaluated_by =
    safe.evaluated_by ||
    context.evaluated_by ||
    (provider ? `${provider}${model ? `/${model}` : ""}` : "gemini");

  let score = normalizeScore(safe.score ?? 5);
  let gaps = Array.isArray(safe.gaps) ? safe.gaps.filter(Boolean).map(String) : [];

  // Enforce insufficient information rule if listing has no JD
  const hasDescription = context.hasDescription ?? Boolean(context.content || safe.content || safe.description || context.jobDescription);
  if (hasDescription === false) {
    if (score > 6.5) {
      score = 6.5;
    }
    const missingJdGap = "No job description available";
    if (!gaps.some((g) => g.toLowerCase().includes("no job description available"))) {
      gaps = [missingJdGap, ...gaps];
    }
  }

  const grade = gradeFromScore(score, context.gradeThresholds || context.grade_thresholds);

  let verdict = String(safe.verdict || "");
  if (!verdict || verdict === "undefined") {
    if (grade === "A" || grade === "B") verdict = "Apply Now";
    else if (grade === "C") verdict = "Apply with Prep";
    else verdict = "Skip";
  } else if ((grade === "D" || grade === "F") && /apply/i.test(verdict)) {
    verdict = "Skip";
  }

  const defaults = {
    company: context.company || "Unknown",
    role: context.role || "Unknown",
    location: context.location || "Unknown",
    provider,
    model,
    evaluated_by,
    score,
    grade,
    verdict,
    strengths: [],
    gaps,
    interview_prep: [],
    action_items: [],
    cv_highlights: [],
    fit_summary: "Evaluation incomplete.",
    salary_estimate: "Not available",
    negotiation_note: "",
    action: "Review the job details manually before applying.",
  };

  return {
    ...defaults,
    ...safe,
    company: String(safe.company || defaults.company),
    role: String(safe.role || defaults.role),
    location: String(safe.location || defaults.location),
    provider: String(safe.provider || defaults.provider),
    model: String(safe.model || defaults.model),
    evaluated_by: String(safe.evaluated_by || defaults.evaluated_by),
    score,
    grade,
    verdict,
    strengths: Array.isArray(safe.strengths) ? safe.strengths.filter(Boolean) : defaults.strengths,
    gaps,
    interview_prep: Array.isArray(safe.interview_prep)
      ? safe.interview_prep.filter(Boolean)
      : defaults.interview_prep,
    action_items: Array.isArray(safe.action_items) ? safe.action_items.filter(Boolean) : defaults.action_items,
    cv_highlights: Array.isArray(safe.cv_highlights) ? safe.cv_highlights.filter(Boolean) : defaults.cv_highlights,
    fit_summary: String(safe.fit_summary || defaults.fit_summary),
    salary_estimate: String(safe.salary_estimate || defaults.salary_estimate),
    negotiation_note: String(safe.negotiation_note || defaults.negotiation_note),
    action: String(safe.action || defaults.action),
  };
}

export function loadConfig({ requireApiKey = true } = {}) {
  const loaded = readFirstExistingJson(CONFIG_FILES);
  if (!loaded) {
    throw new Error("Config file missing. Create config.local.json from config.json first.");
  }

  const jsonConfig = loaded.value || {};
  const config = {
    gemini_model: process.env.GEMINI_MODEL || jsonConfig.gemini_model,
    groq_model: process.env.GROQ_MODEL || jsonConfig.groq_model,
    gemini_daily_request_limit:
      process.env.GEMINI_DAILY_REQUEST_LIMIT || jsonConfig.gemini_daily_request_limit,
    name: jsonConfig.name,
    target_roles: Array.isArray(jsonConfig.target_roles) ? jsonConfig.target_roles : [],
    target_locations: Array.isArray(jsonConfig.target_locations) ? jsonConfig.target_locations : [],
    india_locations: Array.isArray(jsonConfig.india_locations) ? jsonConfig.india_locations : [],
    allow_unrestricted_remote: jsonConfig.allow_unrestricted_remote ?? true,
    fresher_max_min_years: jsonConfig.fresher_max_min_years ?? 0,
    search_profiles: Array.isArray(jsonConfig.search_profiles) ? jsonConfig.search_profiles : [],
    experience_years: jsonConfig.experience_years,
    experience_level: jsonConfig.experience_level,
    expected_ctc_lpa: jsonConfig.expected_ctc_lpa,
    gemini_api_key: process.env.GEMINI_API_KEY || "",
    groq_api_key: process.env.GROQ_API_KEY || "",
  };

  if (requireApiKey && (!config.gemini_api_key || config.gemini_api_key === PLACEHOLDER_API_KEY)) {
    throw new Error(
      "Gemini API key missing. Add GEMINI_API_KEY to .env."
    );
  }

  return config;
}

export function getExperienceProfile(config = {}, overrides = {}) {
  const rawYears = overrides.experience_years ?? config.experience_years;
  const parsedYears = Number(rawYears);
  const experienceYears = Number.isFinite(parsedYears)
    ? Math.max(0, parsedYears)
    : inferYearsFromLevel(config.experience_level);
  const level = normalizeExperienceLevel(config.experience_level, experienceYears);
  return {
    years: experienceYears,
    level,
    label: `${experienceYears} year${experienceYears === 1 ? "" : "s"} (${level})`,
  };
}

function inferYearsFromLevel(level) {
  const normalized = String(level || "").trim().toLowerCase();
  if (!normalized || normalized === "fresher" || normalized === "entry-level") return 0;
  const firstNumber = normalized.match(/\d+/)?.[0];
  if (firstNumber) return Math.max(0, Number(firstNumber));
  return 0;
}

function normalizeExperienceLevel(level, years) {
  const normalized = String(level || "").trim().toLowerCase();
  if (normalized) return normalized;
  if (years <= 0) return "fresher";
  if (years < 2) return "junior";
  if (years < 5) return "mid-level";
  return "experienced";
}

export function extractRelevantExperienceText(text) {
  if (!text || typeof text !== "string") return "";
  // Normalize dashes first
  const normalized = text.replace(/[–—−]/g, "-");
  const sentences = normalized.split(/[.\n;•·|\r]/);
  const relevant = [];

  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    // Check if sentence mentions experience or freshers near numbers or requirements
    if (
      /\b(experience|exp|work\s+exp|relevant\s+exp|yr(s)?\s+(?:of\s+)?exp)\b/i.test(trimmed) ||
      /\b(freshers?(?:\s+welcome)?|no\s+experience|entry[\s-]?level|intern|trainee)\b/i.test(trimmed) ||
      /\b\d+\s*(?:-|to)\s*\d+\s*(?:\+)?\s*(?:years|year|yrs|yr)\b/i.test(trimmed) ||
      /\b\d+\s*\+\s*(?:years|year|yrs|yr)\b/i.test(trimmed)
    ) {
      // Exclude company history/heritage statements like "10-20 years of history / excellence / existence"
      if (/\b(?:years|yrs)\s+of\s+(?:history|excellence|existence|standing|legacy|service|trust)\b/i.test(trimmed)) {
        continue;
      }
      relevant.push(trimmed);
    }
  }

  return relevant.join(" ");
}

export function extractUrlSlugText(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = url.includes("://") ? new URL(url) : null;
    const pathStr = parsed ? parsed.pathname : url;
    const cleanPath = pathStr.replace(/\.[a-z0-9]+$/i, "");
    let slug = decodeURIComponent(cleanPath).replace(/[-_\\/]+/g, " ");
    slug = slug.replace(/\b\d+\s*(?:years|year|yrs|yr)\s+of\s+(?:trust|history|excellence|existence|standing|legacy|service)\b/gi, "");
    return slug;
  } catch {
    return String(url).replace(/[-_\\/]+/g, " ");
  }
}

export function extractMinYears(text) {
  if (!text) return null;
  // Normalize unicode dashes
  let normalized = String(text).replace(/[–—−]/g, "-").toLowerCase();

  // Strip company heritage phrases so 20-years-of-trust is not treated as a requirement
  normalized = normalized.replace(/\b\d+\s*(?:years|year|yrs|yr)\s+of\s+(?:trust|history|excellence|existence|standing|legacy|service)\b/gi, "");

  // 1. Range match: "0-1 years", "0-2 years", "1-3 years", "1 to 3 yrs", "3-5 years", "5-to-9-years"
  const rangeMatch = normalized.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:\+)?\s*(?:years|year|yrs|yr)\b/);
  if (rangeMatch) {
    return Number(rangeMatch[1]);
  }

  // 2. Plus match: "2+ years", "1+ yrs"
  const plusMatch = normalized.match(/(\d+)\s*\+\s*(?:years|year|yrs|yr)\b/);
  if (plusMatch) {
    return Number(plusMatch[1]);
  }

  // 3. Minimum / at least: "minimum 2 years", "at least 1 yr"
  const minMatch = normalized.match(/(?:minimum|min|at least|requires?|looking for)\s+(\d+)\s*(?:years|year|yrs|yr)\b/);
  if (minMatch) {
    return Number(minMatch[1]);
  }

  // 4. Explicit fresher phrases
  if (/\b(freshers?(?:\s+welcome)?|entry[\s-]?level|new grad|graduate program|no\s+experience(?:\s+required)?|0\s*years?)\b/.test(normalized)) {
    return 0;
  }

  return null;
}

export function buildExperienceContext(job = {}) {
  const jdText = [job.content, job.description, job.summary].filter(Boolean).join(" ");
  const relevantJdText = extractRelevantExperienceText(jdText);
  const urlSlugText = extractUrlSlugText(job.url);

  return [
    job.experience,
    job.role,
    job.title,
    relevantJdText,
    urlSlugText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function assessExperienceFit(job = {}, profile = { years: 0, level: "fresher" }, config = {}) {
  const context = buildExperienceContext(job);
  const title = String(job.role || job.title || "").toLowerCase();
  const years = Number(profile?.years || 0);
  const minYears = extractMinYears(context);

  const seniorTitlePatterns = [
    /\bsenior\b/i,
    /\b(sr\.?|snr)\b/i,
    /\bstaff\b/i,
    /\blead\b/i,
    /\bprincipal\b/i,
    /\barchitect\b/i,
    /\bmanager\b/i,
    /\bdirector\b/i,
    /\bhead\b/i,
    /\bvp\b/i,
    /\b(sde[- ]?(?:2|ii|3|iii)|swe[- ]?(?:2|ii|3|iii)|software engineer (?:2|ii|3|iii))\b/i,
    /\b(engineer|developer|sde|mts)\s+(?:2|ii|3|iii|iv)\b/i,
    /\blevel\s+(?:2|ii|3|iii)\b/i,
  ];

  const juniorTitlePatterns = [
    /\bintern(ship)?\b/i,
    /\btrainee\b/i,
    /\bassociate\b/i,
    /\bjunior\b/i,
    /\bentry[\s-]?level\b/i,
    /\bnew grad\b/i,
    /\bfresher\b/i,
    /\bgraduate\b/i,
  ];

  if (seniorTitlePatterns.some((pattern) => pattern.test(title))) {
    return { compatible: false, reason: "senior_title", minYears, experience_unknown: false };
  }

  const isFresher = years <= 0 || profile?.level === "fresher" || profile?.level === "entry-level";
  const fresherMaxMinYears = Number(config?.fresher_max_min_years ?? 0);

  // T-5: Explicit numeric requirement beats junior title
  if (minYears !== null) {
    if (isFresher) {
      if (minYears > fresherMaxMinYears) {
        return { compatible: false, reason: "experience_requirement", minYears, experience_unknown: false };
      }
    } else {
      if (minYears > years + 1) {
        return { compatible: false, reason: "experience_requirement", minYears, experience_unknown: false };
      }
    }
    return { compatible: true, reason: "compatible", minYears, experience_unknown: false };
  }

  // When no numeric minimum is found, junior titles pass as junior_match
  if (juniorTitlePatterns.some((pattern) => pattern.test(title))) {
    return { compatible: true, reason: "junior_match", minYears: 0, experience_unknown: false };
  }

  // When no signals exist, mark experience_unknown: true
  return { compatible: true, reason: "compatible", minYears: null, experience_unknown: true };
}

export function loadCV() {
  if (!fs.existsSync(CV_FILE)) {
    throw new Error("cv.md missing. Fill your real CV before running this tool.");
  }

  const cv = fs.readFileSync(CV_FILE, "utf8");
  if (cv.trim().length < 200 || isPlaceholderCv(cv)) {
    throw new Error("cv.md still contains template text. Replace it with your real CV first.");
  }

  return cv;
}

let cvCache = { content: null, mtimeMs: null };

export function loadCVWithCache() {
  let stat;
  try {
    stat = fs.statSync(CV_FILE);
  } catch {
    throw new Error("cv.md not found. It may have been moved or deleted during the run.");
  }
  if (cvCache.content && cvCache.mtimeMs === stat.mtimeMs) {
    return cvCache.content;
  }

  const cv = loadCV();
  cvCache = {
    content: cv,
    mtimeMs: stat.mtimeMs,
  };
  return cv;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableGeminiError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("temporarily unavailable") ||
    message.includes("503")
  );
}

export function getRetryAfterMs(error) {
  const explicit = Number(error?.retryAfterMs || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const message = String(error?.message || "");
  const retryDelayMatch = message.match(/retryDelay["']?\s*:\s*["']?(\d+)s/i);
  if (retryDelayMatch) return Number(retryDelayMatch[1]) * 1000;

  const retryAfterMatch = message.match(/retry(?:\s|-)?after[^0-9]*(\d+)/i);
  if (retryAfterMatch) return Number(retryAfterMatch[1]) * 1000;

  return 0;
}

export async function withRetry(operation, options = {}) {
  const {
    retries = 4,
    initialDelayMs = 2000,
    factor = 2,
    maxDelayMs = 90000,
    shouldRetry = isRetryableGeminiError,
    onRetry,
  } = options;

  let attempt = 0;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt < retries && shouldRetry(error);
      if (!canRetry) throw error;

      const retryAfterMs = getRetryAfterMs(error);
      const waitMs = Math.max(Math.min(delayMs, maxDelayMs), retryAfterMs);
      attempt += 1;
      if (onRetry) onRetry({ attempt, waitMs, error });
      await sleep(waitMs);
      delayMs *= factor;
    }
  }
}

export { canonicalizeUrl, jobKey, softKey, isSameJob } from "./jobIdentity.mjs";
