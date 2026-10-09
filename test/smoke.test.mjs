import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canonicalizeUrl, jobKey, isJobUrlValid, isJobTitleValid } from "../jobIdentity.mjs";
import { normalizeGeminiError } from "../llm/providers/gemini.mjs";
import { isLocationFit } from "../scanner.mjs";
import { assessExperienceFit } from "../config-utils.mjs";
import { passesAutoQuickFilter } from "../scan-evaluate.mjs";

test("Smoke Test: Core job identity functions", () => {
  const url1 = "https://boards.greenhouse.io/job?gh_jid=12345&utm_source=slack";
  const url2 = "https://boards.greenhouse.io/job?gh_jid=67890";
  assert.strictEqual(canonicalizeUrl(url1), "https://boards.greenhouse.io/job?gh_jid=12345");
  assert.notStrictEqual(jobKey(url1), jobKey(url2));
  assert.strictEqual(isJobUrlValid("https://boards.greenhouse.io/company/jobs/12345"), true);
  assert.strictEqual(isJobTitleValid("Backend Engineer"), true);
  assert.strictEqual(isJobTitleValid("Powered by Greenhouse"), false);
});

test("Smoke Test: Gemini error classification", () => {
  const perMinErr = {
    status: 429,
    message: "Resource has been exhausted (e.g. check quota). Please retry in 21s.",
    errorDetails: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateContentRequestsPerMinutePerProjectPerRegion" }],
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "21s",
      },
    ],
  };
  const normalizedMin = normalizeGeminiError(perMinErr);
  assert.strictEqual(normalizedMin.kind, "rate_minute");

  const perDayErr = {
    status: 429,
    message: "Resource has been exhausted: daily limit reached.",
    errorDetails: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateContentRequestsPerDayPerProjectPerRegion" }],
      },
    ],
  };
  const normalizedDay = normalizeGeminiError(perDayErr);
  assert.strictEqual(normalizedDay.kind, "quota_day");
});

test("Smoke Test: Location fitting rules", () => {
  const cfg = {
    location_filter: {
      india_locations: ["Bengaluru", "Noida", "Gurugram"],
      allow_unrestricted_remote: true
    }
  };
  assert.strictEqual(isLocationFit("Bengaluru, India", cfg, "greenhouse"), true);
  assert.strictEqual(isLocationFit("London, UK", cfg, "greenhouse"), false);
  assert.strictEqual(isLocationFit("Remote", cfg, "greenhouse"), true);
});

test("Smoke Test: Experience assessment", () => {
  const profile = { years: 0, level: "fresher" };
  const config = { fresher_max_min_years: 0 };
  const juniorJob = { role: "Software Engineer", experience: "0-2 years", content: "" };
  assert.strictEqual(assessExperienceFit(juniorJob, profile, config).compatible, true);

  const seniorJob = { role: "Software Engineer", experience: "3-5 years", content: "" };
  assert.strictEqual(assessExperienceFit(seniorJob, profile, config).compatible, false);
});

test("Smoke Test: Quick filter keyword matching", () => {
  const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
  assert.strictEqual(passesAutoQuickFilter({ role: "Software Engineer - Seoul" }, config), true);
  assert.strictEqual(passesAutoQuickFilter({ role: "Salesforce Developer" }, config), false);
  assert.strictEqual(passesAutoQuickFilter({ role: "Security Engineer" }, config), false);
});

test("Smoke Test: Runtime import of all entry and core modules", async () => {
  const modules = [
    "../scanner.mjs",
    "../evaluate.mjs",
    "../scan-evaluate.mjs",
    "../autoflow.mjs",
    "../tracker.mjs",
    "../resume-builder.mjs",
    "../health.mjs",
    "../config-utils.mjs",
    "../jobIdentity.mjs",
    "../process-runner.mjs",
    "../llm/llmClient.mjs",
    "../llm/providers/gemini.mjs",
    "../llm/providers/groq.mjs",
    "../setup-check.mjs",
    "../setup-wizard.mjs",
  ];

  for (const mod of modules) {
    const imported = await import(mod);
    assert.ok(imported, `Module ${mod} must import successfully`);
  }
});
