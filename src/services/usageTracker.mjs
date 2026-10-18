import fs from "fs";
import path from "path";
import {
  USAGE_FILE,
  BREAKER_FILE,
  APPLICATIONS_FILE,
  getDataDir,
  GEMINI_QUOTA_TIME_ZONE,
} from "../config/configPaths.mjs";
import {
  loadJsonFile,
  writeJsonFileAtomic,
  withFileLockSync,
} from "../utils/fileLock.mjs";

const DEFAULT_BREAKER_STATE = Object.freeze({
  gemini: { until: 0, why: "" },
  groq: { until: 0, why: "" },
});

export function readBreakerState() {
  const state = loadJsonFile(BREAKER_FILE, {
    fallback: DEFAULT_BREAKER_STATE,
    warnMessage: "Warning: circuit breaker state file corrupt, resetting",
  });
  return {
    gemini: { ...DEFAULT_BREAKER_STATE.gemini, ...(state?.gemini || {}) },
    groq: { ...DEFAULT_BREAKER_STATE.groq, ...(state?.groq || {}) },
  };
}

export function writeBreakerState(state) {
  writeJsonFileAtomic(BREAKER_FILE, {
    gemini: { ...DEFAULT_BREAKER_STATE.gemini, ...(state?.gemini || {}) },
    groq: { ...DEFAULT_BREAKER_STATE.groq, ...(state?.groq || {}) },
  });
}

export function readGeminiUsage() {
  return loadJsonFile(USAGE_FILE, {
    fallback: {},
    warnMessage: "Warning: usage file corrupt, starting fresh",
  });
}

export function getGeminiUsageDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GEMINI_QUOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function getGeminiUsageStats(dayOverride = null) {
  const day = dayOverride || getGeminiUsageDay();
  const usage = readGeminiUsage();
  const entry = usage[day];

  if (!entry) {
    return { day, total: 0, success: 0, failed: 0 };
  }
  if (typeof entry === "number") {
    return { day, total: entry, success: entry, failed: 0 };
  }
  return {
    day,
    total: Number(entry.total) || 0,
    success: Number(entry.success) || 0,
    failed: Number(entry.failed) || 0,
  };
}

export function getGeminiUsageCount(dayOverride = null, { countType = "success" } = {}) {
  const stats = getGeminiUsageStats(dayOverride);
  if (countType === "total") return stats.total;
  if (countType === "failed") return stats.failed;
  return stats.success;
}

export function trackGeminiCall(dayOverride = null, { success = true } = {}) {
  const day = dayOverride || getGeminiUsageDay();
  return withFileLockSync(USAGE_FILE, () => {
    const usage = readGeminiUsage();
    const current = usage[day];
    let record = { total: 0, success: 0, failed: 0 };

    if (typeof current === "number") {
      record = { total: current, success: current, failed: 0 };
    } else if (current && typeof current === "object") {
      record = {
        total: Number(current.total) || 0,
        success: Number(current.success) || 0,
        failed: Number(current.failed) || 0,
      };
    }

    record.total += 1;
    if (success) {
      record.success += 1;
    } else {
      record.failed += 1;
    }

    usage[day] = record;
    writeJsonFileAtomic(USAGE_FILE, usage, { lock: false });
    return usage;
  });
}

export function backupIfNeeded() {
  const today = getGeminiUsageDay();
  const backupDir = path.resolve(getDataDir(), "backups");
  const backupFile = path.resolve(backupDir, `applications_${today}.json`);
  if (!fs.existsSync(APPLICATIONS_FILE) || fs.existsSync(backupFile)) {
    return null;
  }
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(APPLICATIONS_FILE, backupFile);
  return backupFile;
}
