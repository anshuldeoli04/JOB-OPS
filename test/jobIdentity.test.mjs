import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalizeUrl,
  jobKey,
  isSameJob,
  isJobUrlValid,
  isJobTitleValid,
} from "../jobIdentity.mjs";
import { loadJsonFile } from "../config-utils.mjs";

test("T-1: canonicalizeUrl preserves gh_jid identity parameter", () => {
  const url1 = "https://databricks.com/company/careers/open-positions/job?gh_jid=8001111002";
  const url2 = "https://databricks.com/company/careers/open-positions/job?gh_jid=8002222002";
  const url1WithUtm = "https://databricks.com/company/careers/open-positions/job?gh_jid=8001111002&utm_source=linkedin&utm_medium=cpc";

  const canon1 = canonicalizeUrl(url1);
  const canon2 = canonicalizeUrl(url2);
  const canon1Utm = canonicalizeUrl(url1WithUtm);

  assert.notStrictEqual(canon1, canon2, "Different gh_jid must not canonicalize to the same URL");
  assert.strictEqual(canon1, canon1Utm, "Marketing tracking params must be stripped while preserving gh_jid");
  assert.strictEqual(canon1, "https://databricks.com/company/careers/open-positions/job?gh_jid=8001111002");
});

test("T-1: jobKey produces distinct keys for distinct gh_jid", () => {
  const url1 = "https://databricks.com/company/careers/open-positions/job?gh_jid=8001111002";
  const url2 = "https://databricks.com/company/careers/open-positions/job?gh_jid=8002222002";

  const key1 = jobKey(url1);
  const key2 = jobKey(url2);

  assert.notStrictEqual(key1, key2, "jobKey must be unique per gh_jid");
  assert.strictEqual(key1, "url:https://databricks.com/company/careers/open-positions/job?gh_jid=8001111002");
  assert.strictEqual(key2, "url:https://databricks.com/company/careers/open-positions/job?gh_jid=8002222002");
});

test("T-1: isSameJob returns false for different gh_jid URLs", () => {
  const jobA = {
    url: "https://databricks.com/company/careers/open-positions/job?gh_jid=8001111002",
    title: "Software Engineer - Data",
    company: "Databricks",
  };
  const jobB = {
    url: "https://databricks.com/company/careers/open-positions/job?gh_jid=8002222002",
    title: "Software Engineer - Platform",
    company: "Databricks",
  };

  assert.strictEqual(isSameJob(jobA, jobB), false, "Jobs with different gh_jid must not be considered the same job");
});

test("T-1: Database migration check — existing scan-results.json has 0 key collisions", () => {
  const scanPath = path.resolve(process.env.JOB_OPS_DATA_DIR || "./data", "scan-results.json");
  if (fs.existsSync(scanPath)) {
    const records = loadJsonFile(scanPath, { fallback: [] });
    const keys = new Set();
    let collisions = 0;
    records.forEach((record) => {
      const k = jobKey(record);
      if (keys.has(k)) collisions++;
      keys.add(k);
    });
    assert.strictEqual(collisions, 0, "No duplicate key collisions must occur in existing scan database");
  }
});

test("T-4: Slugs containing hyphenated words are NOT falsely rejected", () => {
  const validJobUrls = [
    "https://example.com/jobs/news-platform-backend-engineer",
    "https://example.com/careers/team-lead-backend",
    "https://internshala.com/job/detail/support-executive-job-at-tech-123",
  ];

  validJobUrls.forEach((url) => {
    assert.strictEqual(isJobUrlValid(url), true, `URL should be valid: ${url}`);
  });
});

test("T-4: Root URLs, navigation anchors, and vulnerability disclosure pages are rejected", () => {
  const invalidUrls = [
    "https://www.ashbyhq.com/",
    "https://jobs.ashbyhq.com/",
    "https://example.com/vulnerability-disclosure",
    "https://example.com/privacy-policy",
    "https://example.com/login",
  ];

  invalidUrls.forEach((url) => {
    assert.strictEqual(isJobUrlValid(url), false, `URL should be invalid: ${url}`);
  });
});

test("T-4: Stoplist titles (exact and prefix) are rejected", () => {
  const invalidTitles = [
    "Powered by Ashby",
    "Vulnerability Disclosure",
    "Security",
    "Create profile",
    "Privacy Policy",
    "Terms of Service",
    "Careers",
    "All Jobs",
  ];

  invalidTitles.forEach((title) => {
    assert.strictEqual(isJobTitleValid(title), false, `Title should be rejected: ${title}`);
  });

  const validTitles = [
    "Software Engineer",
    "Junior Java Developer",
    "Backend Engineer",
    "Full Stack Developer",
  ];

  validTitles.forEach((title) => {
    assert.strictEqual(isJobTitleValid(title), true, `Title should be accepted: ${title}`);
  });
});
