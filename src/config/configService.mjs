import fs from "fs";
import path from "path";
import { REPO_ROOT, CV_FILE, PLACEHOLDER_API_KEY } from "./configPaths.mjs";
import { withFileLockSync, syncSleep, loadJsonFile } from "../utils/fileLock.mjs";

const ENV_FILES = [path.resolve(REPO_ROOT, ".env.local"), path.resolve(REPO_ROOT, ".env")];
const PLACEHOLDER_RE = /\[\[[^\]\n]{2,80}\]\]/;

export function loadEnvFiles() {
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
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {}
  });

  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined && v !== null) process.env[k] = String(v);
  }
}

export function isPlaceholderCv(content) {
  if (!content || typeof content !== "string" || content.trim().length < 200) {
    return true;
  }
  return PLACEHOLDER_RE.test(content);
}

export function loadConfig({ requireApiKey = true } = {}) {
  const baseConfig = loadJsonFile(path.resolve(REPO_ROOT, "config.json"), { fallback: null });
  const localConfig = loadJsonFile(path.resolve(REPO_ROOT, "config.local.json"), { fallback: null });
  if (!baseConfig && !localConfig) {
    throw new Error("Config file missing. Run `npm run setup` to configure JOB-OPS.");
  }

  const jsonConfig = { ...(baseConfig || {}), ...(localConfig || {}) };
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
    disabled_sources: Array.isArray(jsonConfig.disabled_sources)
      ? jsonConfig.disabled_sources
      : ["wellfound", "naukri", "internshala"],
    expected_min_cards: jsonConfig.expected_min_cards,
    experience_years: jsonConfig.experience_years,
    experience_level: jsonConfig.experience_level,
    expected_ctc_lpa: jsonConfig.expected_ctc_lpa,
    gemini_api_key: process.env.GEMINI_API_KEY || "",
    groq_api_key: process.env.GROQ_API_KEY || "",
  };

  if (requireApiKey && (!config.gemini_api_key || config.gemini_api_key === PLACEHOLDER_API_KEY)) {
    throw new Error("Gemini API key missing. Add GEMINI_API_KEY to .env.");
  }

  return config;
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
