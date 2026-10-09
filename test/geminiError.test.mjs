import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGeminiError, parseGeminiErrorDetails } from "../llm/providers/gemini.mjs";
import { getNextPacificMidnight, providerHealth } from "../llm/llmClient.mjs";

test("T-2: Per-minute 429 with QuotaFailure and RetryInfo is classified as rate_minute", () => {
  const errMinute = {
    status: 429,
    message: "Resource has been exhausted (e.g. check quota). Please retry in 21s.",
    errorDetails: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaId: "GenerateContentRequestsPerMinutePerProjectPerRegion",
            description: "Per minute limit reached",
          },
        ],
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "21s",
      },
    ],
  };

  const parsed = parseGeminiErrorDetails(errMinute);
  assert.strictEqual(parsed.quotaId, "GenerateContentRequestsPerMinutePerProjectPerRegion");
  assert.strictEqual(parsed.retryDelayMs, 21000);

  const normalized = normalizeGeminiError(errMinute);
  assert.strictEqual(normalized.kind, "rate_minute");
  assert.strictEqual(normalized.status, 429);
  assert.strictEqual(normalized.retryAfterMs, 21000);
});

test("T-2: Per-day 429 with PerDay quotaId is classified as quota_day", () => {
  const errDay = {
    status: 429,
    message: "Resource has been exhausted: daily limit reached.",
    errorDetails: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaId: "GenerateContentRequestsPerDayPerProjectPerRegion",
            description: "Daily quota exhausted",
          },
        ],
      },
    ],
  };

  const normalized = normalizeGeminiError(errDay);
  assert.strictEqual(normalized.kind, "quota_day");
  assert.strictEqual(normalized.status, 429);
  assert.strictEqual(normalized.retryAfterMs, null);
});

test("T-2: Plain 429 without details defaults to rate_minute with 30s cooldown (never daily)", () => {
  const errPlain = {
    status: 429,
    message: "Too Many Requests",
  };

  const normalized = normalizeGeminiError(errPlain);
  assert.strictEqual(normalized.kind, "rate_minute");
  assert.strictEqual(normalized.status, 429);
  assert.strictEqual(normalized.retryAfterMs, 30000);
});

test("T-2: getNextPacificMidnight calculates exact Pacific midnight using Intl", () => {
  const nextMidnightMs = getNextPacificMidnight();
  const nextMidnightDate = new Date(nextMidnightMs);

  const ptFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const ptTimeStr = ptFormatter.format(nextMidnightDate);
  // Midnight in 24h format is 00:00:00 or 24:00:00
  assert.match(ptTimeStr, /^(00:00:00|24:00:00|0:00:00)$/, "Resulting time in Los Angeles must be exactly 00:00:00");
  assert.ok(nextMidnightMs > Date.now(), "Next midnight must be in the future");
  assert.ok(nextMidnightMs <= Date.now() + 24 * 3600 * 1000, "Next midnight must be within 24 hours");
});
