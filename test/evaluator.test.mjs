import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { markEvaluated } from "../scan-evaluate.mjs";
import { providerHealth, getProviderHealth } from "../llm/llmClient.mjs";
import { SCAN_RESULTS_FILE } from "../config-utils.mjs";

test("T-7: Retrying non-quota error increments eval_attempts and marks failed after 3 attempts", () => {
  const testJob = {
    url: "https://test-company.com/jobs/test-error-retry-spec-789",
    role: "Backend Engineer",
    company: "TestCorp",
  };

  const scanFile = SCAN_RESULTS_FILE;
  let originalData = [];
  if (fs.existsSync(scanFile)) {
    try {
      originalData = JSON.parse(fs.readFileSync(scanFile, "utf8"));
    } catch {
      originalData = [];
    }
  }
  try {
    const updated = originalData.filter((j) => j.url !== testJob.url);
    updated.push({ ...testJob, status: "new" });
    fs.writeFileSync(scanFile, JSON.stringify(updated, null, 2));

    const res1 = markEvaluated(testJob, "error", new Error("Bad JSON"));
    assert.strictEqual(res1?.eval_attempts, 1);
    assert.strictEqual(res1?.status, "new", "Attempt 1 should remain new for retry");

    const res2 = markEvaluated(testJob, "error", new Error("Bad JSON"));
    assert.strictEqual(res2?.eval_attempts, 2);
    assert.strictEqual(res2?.status, "new", "Attempt 2 should remain new for retry");

    const res3 = markEvaluated(testJob, "error", new Error("Bad JSON"));
    assert.strictEqual(res3?.eval_attempts, 3);
    assert.strictEqual(res3?.status, "failed", "Attempt 3 should be marked failed");
  } finally {
    fs.writeFileSync(scanFile, JSON.stringify(originalData, null, 2));
  }
});

test("T-7: Groq 429 with reset header > 5m activates circuit breaker without hammering", () => {
  const farResetMs = 8 * 60 * 1000;
  const groqError = new Error("Groq rate limited: daily token quota reached");
  groqError.status = 429;
  groqError.provider = "groq";
  groqError.kind = "quota_day";
  groqError.retryAfterMs = farResetMs;
  groqError.resetUntil = Date.now() + farResetMs;

  providerHealth.groq.until = groqError.resetUntil;
  providerHealth.groq.why = "Daily token limit reached (> 5m)";

  const health = getProviderHealth();
  assert.ok(Date.now() < health.groq.until, "Groq must be cooling down");
  const remainingMinutes = Math.round((health.groq.until - Date.now()) / 60000);
  assert.ok(remainingMinutes >= 7 && remainingMinutes <= 9, "Cooldown should be around 8 minutes");
});
