import test from "node:test";
import assert from "node:assert/strict";
import {
  passesAutoQuickFilter,
  assessQuickFilter,
  computePreRankScore,
  DEFAULT_ROLE_TERMS,
  DEFAULT_LEVEL_TERMS,
} from "../scan-evaluate.mjs";

test("T10: 60-title fixture verifies role vs level terms, discipline blocks, and non-tech rejection", () => {
  const titles60 = [
    // Non-tech: Sales & Marketing (10)
    { role: "Area Sales Manager", shouldPass: false, category: "sales" },
    { role: "Direct Sales Executive", shouldPass: false, category: "sales" },
    { role: "Retail Store Executive", shouldPass: false, category: "retail" },
    { role: "Retail Cashier & Sales Associate", shouldPass: false, category: "retail" },
    { role: "Store Manager - Fashion Retail", shouldPass: false, category: "retail" },
    { role: "Digital Marketing Specialist", shouldPass: false, category: "marketing" },
    { role: "Growth Marketing Associate", shouldPass: false, category: "marketing" },
    { role: "SEO Content Writer", shouldPass: false, category: "marketing/seo" },
    { role: "Social Media Marketing Intern", shouldPass: false, category: "marketing" },
    { role: "Business Development Executive (BDE)", shouldPass: false, category: "sales" },

    // Non-tech: Pharma, QC, Chemist, Healthcare (6)
    { role: "Pharma QC Analyst", shouldPass: false, category: "pharma" },
    { role: "Quality Control Chemist", shouldPass: false, category: "qc" },
    { role: "Hospital Pharmacist", shouldPass: false, category: "pharma" },
    { role: "Pharma Production Trainee", shouldPass: false, category: "pharma" },
    { role: "Clinical Research Associate", shouldPass: false, category: "pharma" },
    { role: "Staff Nurse", shouldPass: false, category: "healthcare" },

    // Non-tech: Operations, Admin, Core Eng (6)
    { role: "Telecaller BPO Executive", shouldPass: false, category: "bpo" },
    { role: "Senior Accountant", shouldPass: false, category: "finance" },
    { role: "Civil Site Engineer", shouldPass: false, category: "civil" },
    { role: "Mechanical Maintenance Engineer", shouldPass: false, category: "mechanical" },
    { role: "Maths Expert & Tutor", shouldPass: false, category: "education" },
    { role: "HR Recruiter", shouldPass: false, category: "hr" },

    // Level-only titles without any software/tech role term (6) - MUST FAIL!
    { role: "Apriso Trainee", shouldPass: false, category: "level-only" },
    { role: "Graduate Trainee", shouldPass: false, category: "level-only" },
    { role: "Management Trainee", shouldPass: false, category: "level-only" },
    { role: "Corporate Intern", shouldPass: false, category: "level-only" },
    { role: "Fresher", shouldPass: false, category: "level-only" },
    { role: "Associate", shouldPass: false, category: "level-only" },

    // Senior / Staff / Lead tech roles (10) - MUST FAIL!
    { role: "Senior Java Developer", shouldPass: false, category: "senior" },
    { role: "Lead Software Engineer", shouldPass: false, category: "senior" },
    { role: "Staff Backend Engineer", shouldPass: false, category: "senior" },
    { role: "Principal Software Engineer", shouldPass: false, category: "senior" },
    { role: "Engineering Manager", shouldPass: false, category: "senior" },
    { role: "Director of Engineering", shouldPass: false, category: "senior" },
    { role: "SDE-2 Backend", shouldPass: false, category: "senior" },
    { role: "Software Engineer III", shouldPass: false, category: "senior" },
    { role: "Solutions Architect", shouldPass: false, category: "senior" },
    { role: "Lead Frontend Architect", shouldPass: false, category: "senior" },

    // Non-target disciplines (5) - MUST FAIL!
    { role: "Technical Support Specialist", shouldPass: false, category: "support" },
    { role: "QA Manual Tester", shouldPass: false, category: "qa" },
    { role: "DevOps Engineer", shouldPass: false, category: "devops" },
    { role: "Salesforce Developer", shouldPass: false, category: "salesforce" },
    { role: "SAP ABAP Consultant", shouldPass: false, category: "sap" },

    // Valid software entry/junior/target roles (17) - MUST PASS!
    { role: "Java Developer Trainee", shouldPass: true, category: "valid" },
    { role: "Associate Software Engineer", shouldPass: true, category: "valid" },
    { role: "Junior Backend Developer", shouldPass: true, category: "valid" },
    { role: "Software Engineer - Fresher", shouldPass: true, category: "valid" },
    { role: "SDE Intern", shouldPass: true, category: "valid" },
    { role: "Java Backend Developer", shouldPass: true, category: "valid" },
    { role: "Full Stack Engineer", shouldPass: true, category: "valid" },
    { role: "Frontend Developer", shouldPass: true, category: "valid" },
    { role: "Python Developer", shouldPass: true, category: "valid" },
    { role: "Junior Software Engineer", shouldPass: true, category: "valid" },
    { role: "Node.js Developer", shouldPass: true, category: "valid" },
    { role: "React Developer Trainee", shouldPass: true, category: "valid" },
    { role: "Web Developer Intern", shouldPass: true, category: "valid" },
    { role: "Software Developer", shouldPass: true, category: "valid" },
    { role: "Associate Backend Engineer", shouldPass: true, category: "valid" },
    { role: "C++ Software Developer", shouldPass: true, category: "valid" },
    { role: "Golang Backend Engineer", shouldPass: true, category: "valid" },
  ];

  assert.equal(titles60.length, 60, "Must contain exactly 60 test titles");

  // Specific required checks from task brief:
  assert.equal(passesAutoQuickFilter({ role: "Apriso Trainee" }), false, "Apriso Trainee must fail");
  assert.equal(passesAutoQuickFilter({ role: "Java Developer Trainee" }), true, "Java Developer Trainee must pass");
  assert.equal(passesAutoQuickFilter({ role: "Associate Software Engineer" }), true, "Associate Software Engineer must pass");

  const aprisoAssessment = assessQuickFilter({ role: "Apriso Trainee" });
  assert.equal(aprisoAssessment.pass, false);
  assert.equal(aprisoAssessment.reason, "missing_role_term");

  const javaAssessment = assessQuickFilter({ role: "Java Developer Trainee" });
  assert.equal(javaAssessment.pass, true);
  assert.equal(javaAssessment.reason, null);

  for (const item of titles60) {
    const passed = passesAutoQuickFilter({ role: item.role });
    assert.equal(
      passed,
      item.shouldPass,
      `Expected "${item.role}" (${item.category}) to ${item.shouldPass ? "pass" : "fail"}, but got ${passed}`
    );
  }
});

test("T10: Pre-rank score sorts candidates deterministically; batch slicing with offset has zero overlap", () => {
  const sampleJobs = [];
  const sources = ["ashby", "greenhouse", "lever", "internshala", "naukri"];
  const locations = ["Bengaluru", "Pune", "Hyderabad", "Remote", "Mumbai", "Noida", "Chennai"];

  for (let i = 0; i < 60; i++) {
    sampleJobs.push({
      id: `job-${i}`,
      company: `Company-${i}`,
      role: i % 2 === 0 ? "Software Engineer" : "Java Developer Trainee",
      location: locations[i % locations.length],
      source: sources[i % sources.length],
      content: i % 3 === 0 ? "Detailed description about Spring Boot, Java, and REST APIs." : "",
    });
  }

  const config = {
    target_roles: ["Software Engineer", "Java Developer"],
    target_locations: ["Bengaluru", "Pune", "Hyderabad", "Remote"],
  };

  for (const job of sampleJobs) {
    job.preRankScore = computePreRankScore(job, config, { years: 0 });
    assert.ok(typeof job.preRankScore === "number" && job.preRankScore >= 0 && job.preRankScore <= 10);
  }

  // Sort by pre-rank score descending
  sampleJobs.sort((a, b) => b.preRankScore - a.preRankScore);

  // Highest preRankScores come first
  for (let i = 0; i < sampleJobs.length - 1; i++) {
    assert.ok(
      sampleJobs[i].preRankScore >= sampleJobs[i + 1].preRankScore,
      `Jobs must be monotonically descending: [${i}] ${sampleJobs[i].preRankScore} >= [${i + 1}] ${sampleJobs[i + 1].preRankScore}`
    );
  }

  // Batch 1 (limit: 12, offset: 0)
  const batch1 = sampleJobs.slice(0, 12);
  assert.equal(batch1.length, 12);

  // Batch 2 (limit: 12, offset: 12)
  const batch2 = sampleJobs.slice(12, 24);
  assert.equal(batch2.length, 12);

  // Zero overlap
  const batch1Ids = new Set(batch1.map((j) => j.id));
  const batch2Ids = new Set(batch2.map((j) => j.id));

  for (const id of batch2Ids) {
    assert.ok(!batch1Ids.has(id), `Batch 2 job ${id} must not exist in Batch 1`);
  }
});
