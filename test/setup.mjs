import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 1. Detect offline mode from npm lifecycle event
if (process.env.npm_lifecycle_event === "test:offline") {
  process.env.TEST_OFFLINE = "1";
  process.env.SKIP_BROWSER_TESTS = "1";
}

// 2. Ensure test environment variables
process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";
process.env.ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || "0123456789abcdef";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-at-least-32-chars-long";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "fake-test-gemini-key";

// 3. Create isolated temp directory for all test data mutations
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-ops-test-"));
process.env.JOB_OPS_DATA_DIR = tempDir;

// 4. Seed clean data files in temp directory
fs.writeFileSync(path.join(tempDir, "scan-results.json"), "[]", "utf8");
fs.writeFileSync(path.join(tempDir, "applications.json"), "[]", "utf8");
fs.writeFileSync(path.join(tempDir, "usage.json"), "{}", "utf8");
fs.writeFileSync(
  path.join(tempDir, "breaker.json"),
  JSON.stringify({ gemini: { until: 0, why: "" }, groq: { until: 0, why: "" } }),
  "utf8"
);
fs.writeFileSync(path.join(tempDir, "health-log.jsonl"), "", "utf8");

// 5. Cleanup on process exit
process.on("exit", () => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});
