import test from "node:test";
import assert from "node:assert/strict";
import { assessExperienceFit, extractMinYears, extractUrlSlugText, buildExperienceContext } from "../config-utils.mjs";

test("T11: URL slug experience requirement parsing rejects senior/experienced walk-in URLs", () => {
  const profile = { years: 0, level: "fresher" };
  const config = { fresher_max_min_years: 0 };

  // 1. HCLTech walk-in URL containing 5-to-9-years
  const hclJob = {
    role: "Walk-in || Java Developer",
    url: "https://www.naukri.com/job-listings-java-developer-hcltech-pune-chennai-bengaluru-5-to-9-years-020626009387",
    experience: "06 Jun" // Notice date text captured by DOM scraper
  };

  const hclFit = assessExperienceFit(hclJob, profile, config);
  assert.strictEqual(hclFit.compatible, false, "Job requiring 5-9 years must not be compatible with fresher profile");
  assert.strictEqual(hclFit.minYears, 5, "Should extract minYears 5 from URL slug");
  assert.strictEqual(hclFit.reason, "experience_requirement");
});

test("T11: Company heritage/standing names in URL or text are NOT treated as experience requirements", () => {
  const profile = { years: 0, level: "fresher" };
  const config = { fresher_max_min_years: 0 };

  const trustJob = {
    role: "Software Engineer",
    url: "https://jobs.example.com/20-years-of-trust-infotech/openings",
    experience: null
  };

  const fit = assessExperienceFit(trustJob, profile, config);
  assert.strictEqual(fit.compatible, true, "Company heritage expression must not disqualify job");
  assert.strictEqual(fit.minYears, null, "minYears must be null, not 20");
});

test("T11: Role with no experience signals is marked experience_unknown: true", () => {
  const profile = { years: 0, level: "fresher" };
  const config = { fresher_max_min_years: 0 };

  const genericJob = {
    role: "Software Engineer",
    url: "https://jobs.example.com/posting/12345",
    experience: null,
    content: ""
  };

  const fit = assessExperienceFit(genericJob, profile, config);
  assert.strictEqual(fit.compatible, true);
  assert.strictEqual(fit.minYears, null);
  assert.strictEqual(fit.experience_unknown, true, "Should flag experience_unknown when no signals are present");
});
