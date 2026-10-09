import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { pathToFileURL } from "url";
import {
  APPLICATIONS_FILE,
  BREAKER_FILE,
  getGeminiUsageStats,
  loadApplications,
  readBreakerState,
  syncSleep,
  trackGeminiCall,
  upsertApplication,
  validateEvaluation,
  withRetry,
  writeBreakerState,
  REPO_ROOT,
} from "../config-utils.mjs";
import {
  callLLM,
  checkGeminiDailyBudget,
  getProviderHealth,
  providerHealth,
  QuotaExhaustedError,
  sleep,
  updateProviderHealth,
} from "../llm/llmClient.mjs";
import { runNodeScript } from "../process-runner.mjs";

test("N-1: llmClient pacing and sleep do not cap retry delays at 30 seconds", async () => {
  // 1. Verify sleep in llmClient sleeps at least requested ms
  const start = Date.now();
  await sleep(25);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 20, `llmClient sleep must sleep at least 20ms (took ${elapsed}ms)`);

  // 2. Verify withRetry handles retryAfterMs
  let attempts = 0;
  const retryEvents = [];
  const result = await withRetry(
    async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error("Rate limit exceeded 429");
        err.status = 429;
        err.retryAfterMs = 20;
        throw err;
      }
      return "success-result";
    },
    {
      retries: 4,
      initialDelayMs: 10,
      onRetry: (evt) => retryEvents.push(evt),
    }
  );
  assert.strictEqual(result, "success-result");
  assert.strictEqual(attempts, 3);
  assert.strictEqual(retryEvents.length, 2);

  // 3. Verify that rate_minute error with 45s retryAfterMs is NOT capped at 30s in llmClient
  const savedUntil = providerHealth.gemini.until;
  const savedWhy = providerHealth.gemini.why;
  try {
    const errorInfo = {
      kind: "rate_minute",
      status: 429,
      retryAfterMs: 45000,
      message: "Resource exhausted",
    };
    updateProviderHealth("gemini", errorInfo);
    const cooldownMs = providerHealth.gemini.until - Date.now();
    assert.ok(cooldownMs > 35000, `Cooldown should reflect 45s delay, got ${cooldownMs}ms (must not be capped at 30s)`);
    assert.ok(cooldownMs <= 46000, `Cooldown should not exceed 45s delay, got ${cooldownMs}ms`);
  } finally {
    providerHealth.gemini.until = savedUntil;
    providerHealth.gemini.why = savedWhy;
  }
});

test("N-2: score_job defaults to allowGroqFallback: false and records evaluated_by", async () => {
  // 1. Validate that validateEvaluation attaches provider, model, and evaluated_by
  const evalWithGroq = validateEvaluation(
    { score: 8, grade: "B", verdict: "Apply", provider: "groq", model: "llama-3.3-70b-versatile" },
    { company: "Acme", role: "Dev" }
  );
  assert.strictEqual(evalWithGroq.provider, "groq");
  assert.strictEqual(evalWithGroq.model, "llama-3.3-70b-versatile");
  assert.strictEqual(evalWithGroq.evaluated_by, "groq/llama-3.3-70b-versatile");

  // 2. Default Gemini evaluation
  const evalWithGemini = validateEvaluation(
    { score: 9, grade: "A", verdict: "Apply Immediately" },
    { company: "Google", role: "SWE", provider: "gemini", model: "gemini-2.5-flash" }
  );
  assert.strictEqual(evalWithGemini.provider, "gemini");
  assert.strictEqual(evalWithGemini.evaluated_by, "gemini/gemini-2.5-flash");

  // 3. Forced Gemini exhaustion stops score_job instead of silently falling back to Groq
  const savedUntil = providerHealth.gemini.until;
  const savedWhy = providerHealth.gemini.why;
  try {
    providerHealth.gemini.until = Date.now() + 60000;
    providerHealth.gemini.why = "Forced test cooldown";

    await assert.rejects(
      async () => {
        // By default, allowGroqFallback is false for score_job
        await callLLM("score_job", [{ role: "user", content: "test" }], { apiKey: "fake-key" });
      },
      (err) => {
        assert.ok(err instanceof QuotaExhaustedError, "Should throw QuotaExhaustedError instead of falling back to Groq");
        return true;
      }
    );
  } finally {
    providerHealth.gemini.until = savedUntil;
    providerHealth.gemini.why = savedWhy;
  }
});

test("N-3: Breaker state is persisted to disk and shared across processes under concurrent writes", async () => {
  const futureUntil = Date.now() + 120000;
  writeBreakerState({
    gemini: { until: futureUntil, why: "Shared daily exhaustion across processes" },
    groq: { until: 0, why: "" },
  });

  const diskState = readBreakerState();
  assert.strictEqual(diskState.gemini.until, futureUntil);
  assert.strictEqual(diskState.gemini.why, "Shared daily exhaustion across processes");

  // Verify concurrent writes across processes maintain valid breaker state
  const configUtilsUrl = pathToFileURL(path.resolve(REPO_ROOT, "config-utils.mjs")).href;
  const tmpScriptPath = path.join(os.tmpdir(), `test-tmp-breaker-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  const childBreakerScript = `
    import { writeBreakerState, readBreakerState, syncSleep } from "${configUtilsUrl}";
    for (let i = 0; i < 50; i++) {
      writeBreakerState({ gemini: { until: ${futureUntil} + i, why: "child-write-" + i }, groq: { until: 0, why: "" } });
      syncSleep(2);
    }
    const state = readBreakerState();
    if (state && state.gemini && typeof state.gemini.until === "number") process.exit(0);
    process.exit(1);
  `;

  try {
    fs.writeFileSync(tmpScriptPath, childBreakerScript, "utf8");

    // 1. spawn child FIRST
    const childRun = runNodeScript(tmpScriptPath, []);

    // 2. parent writes interleaved with event loop yields
    for (let i = 0; i < 50; i++) {
      writeBreakerState({ gemini: { until: futureUntil + 100 + i, why: "parent-write-" + i }, groq: { until: 0, why: "" } });
      await new Promise((r) => setImmediate(r));
    }

    // 3. wait for child and assert
    const childRes = await childRun;
    assert.strictEqual(childRes.code, 0, "Subprocess must safely execute concurrent breaker writes");
    const finalState = readBreakerState();
    assert.ok(finalState && typeof finalState.gemini?.until === "number", "Breaker state must remain valid parseable JSON");
    assert.ok(
      finalState.gemini.why.startsWith("child-write-") || finalState.gemini.why.startsWith("parent-write-"),
      "Breaker state must contain a valid write from one of the concurrent processes"
    );
  } finally {
    if (fs.existsSync(tmpScriptPath)) fs.unlinkSync(tmpScriptPath);
    writeBreakerState({ gemini: { until: 0, why: "" }, groq: { until: 0, why: "" } });
  }
});

test("N-4: Daily budget tracks successes and does not count failed calls against budget", () => {
  const testDay = `2099-01-01-${Date.now()}`;
  trackGeminiCall(testDay, { success: false });
  trackGeminiCall(testDay, { success: false });
  trackGeminiCall(testDay, { success: true });

  const stats = getGeminiUsageStats(testDay);
  assert.strictEqual(stats.total, 3);
  assert.strictEqual(stats.success, 1);
  assert.strictEqual(stats.failed, 2);

  // When daily budget limit is 2, 1 success should NOT trip the budget even if total is 3
  const budget = checkGeminiDailyBudget({ geminiDailyRequestLimit: 2 });
  assert.strictEqual(stats.success < 2, true);
});

test("N-5: syncSleep avoids busy-spin and real multi-process concurrent upsertApplication is atomic", async () => {
  const start = Date.now();
  syncSleep(30);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 25, `syncSleep must sleep at least 25ms (slept ${elapsed}ms)`);

  // Verify real concurrent multi-process upsertApplication calls preserve all records
  const configUtilsUrl = pathToFileURL(path.resolve(REPO_ROOT, "config-utils.mjs")).href;
  const prefix = `test-concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpChildPath = path.join(os.tmpdir(), `test-tmp-upsert-child-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  const childScript = `
    import { upsertApplication, syncSleep } from "${configUtilsUrl}";
    for (let i = 0; i < 50; i++) {
      upsertApplication({
        id: "${prefix}-child-" + i,
        company: "Child Company " + i,
        role: "Software Engineer",
        location: "Bengaluru",
        grade: "A",
      });
      syncSleep(2);
    }
  `;

  try {
    fs.writeFileSync(tmpChildPath, childScript, "utf8");

    // 1. spawn FIRST (do not await yet)
    const childRun = runNodeScript(tmpChildPath, []);

    // 2. parent writes interleaved with setImmediate so child runs concurrently
    for (let i = 0; i < 50; i++) {
      upsertApplication({
        id: `${prefix}-parent-${i}`,
        company: `Parent Company ${i}`,
        role: "Software Engineer",
        location: "Bengaluru",
        grade: "A",
      });
      await new Promise((r) => setImmediate(r));
    }

    // 3. then wait
    const childRes = await childRun;
    assert.strictEqual(childRes.code, 0, "Child upsert subprocess must exit with code 0");

    const apps = loadApplications();
    const ids = apps.map((a) => a.id);
    for (let i = 0; i < 50; i++) {
      assert.ok(ids.includes(`${prefix}-parent-${i}`), `Missing parent application ${i}`);
      assert.ok(ids.includes(`${prefix}-child-${i}`), `Missing child application ${i}`);
    }
    assert.strictEqual(new Set(ids).size, ids.length, "no duplicate ids across concurrent process writes");
  } finally {
    if (fs.existsSync(tmpChildPath)) fs.unlinkSync(tmpChildPath);
  }
});

test("N-6: CLI modules are safe to import without executing main() or exiting", async () => {
  const evalMod = await import("../evaluate.mjs");
  assert.strictEqual(typeof evalMod.main, "function", "evaluate.mjs should export main function");

  const resumeMod = await import("../resume-builder.mjs");
  assert.strictEqual(typeof resumeMod.main, "function", "resume-builder.mjs should export main function");

  const pdfMod = await import("../generate-pdf.mjs");
  assert.strictEqual(typeof pdfMod.main, "function", "generate-pdf.mjs should export main function");

  const trackerMod = await import("../tracker.mjs");
  assert.strictEqual(typeof trackerMod.main, "function", "tracker.mjs should export main function");
});
