import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../");

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
export const PLACEHOLDER_API_KEY = "YOUR_GEMINI_API_KEY_HERE";

export function getDataDir() {
  const dir = process.env.JOB_OPS_DATA_DIR
    ? path.resolve(process.env.JOB_OPS_DATA_DIR)
    : path.resolve(REPO_ROOT, "data");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return dir;
}

export function getDataFilePath(filename) {
  return path.resolve(getDataDir(), filename);
}

export function getConfigPaths() {
  return [
    path.resolve(REPO_ROOT, "config.local.json"),
    path.resolve(REPO_ROOT, "config.json"),
  ];
}

export function getPlaceholderApiKey() {
  return PLACEHOLDER_API_KEY;
}
