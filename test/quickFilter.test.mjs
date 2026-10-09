import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { passesAutoQuickFilter } from "../scan-evaluate.mjs";

test("T-6: Quick filter word boundaries and title allowlist", () => {
  const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

  const testCases = [
    { title: "Software Engineer - Seoul", shouldPass: true },
    { title: "Salesforce Developer", shouldPass: false },
    { title: "Sales Executive", shouldPass: false },
    { title: "Software Developer Trainee", shouldPass: true },
    { title: "Associate Software Engineer", shouldPass: true },
    { title: "WLAN Testing Engineer", shouldPass: false },
    { title: "Product Support Engineer", shouldPass: false },
    { title: "Security Engineer", shouldPass: false },
    { title: "Deployment Strategist", shouldPass: false },
  ];

  testCases.forEach((tc) => {
    const res = passesAutoQuickFilter({ role: tc.title }, config);
    assert.strictEqual(
      res,
      tc.shouldPass,
      `Role "${tc.title}" expected shouldPass=${tc.shouldPass} but got ${res}`
    );
  });
});
