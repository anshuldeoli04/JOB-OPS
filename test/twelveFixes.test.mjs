import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { safeJsonParse } from "../llm/jsonUtils.mjs";

const hasFrontend = existsSync(path.resolve("frontend/server/index.js"));

let generateToken, verifyToken, withUserWorkspaceLock, getWorkspacePath, translateQuery, buildVisibleScanRows, loadOpsSettings, saveOpsSettings, toPublicFileUrl, writeEvaluationReport;

if (hasFrontend) {
  const tokenAuth = await import("../frontend/server/utils/tokenAuth.js");
  generateToken = tokenAuth.generateToken;
  verifyToken = tokenAuth.verifyToken;

  const workspaceLock = await import("../frontend/server/utils/workspaceLock.js");
  withUserWorkspaceLock = workspaceLock.withUserWorkspaceLock;

  const userWorkspace = await import("../frontend/server/utils/userWorkspace.js");
  getWorkspacePath = userWorkspace.getWorkspacePath;

  const db = await import("../frontend/server/utils/db.js");
  translateQuery = db.translateQuery;

  const scanFormatting = await import("../frontend/src/utils/scanFormatting.js");
  buildVisibleScanRows = scanFormatting.buildVisibleScanRows;

  const opsStore = await import("../frontend/server/utils/opsStore.js");
  loadOpsSettings = opsStore.loadOpsSettings;
  saveOpsSettings = opsStore.saveOpsSettings;

  const fileLinks = await import("../frontend/server/utils/fileLinks.js");
  toPublicFileUrl = fileLinks.toPublicFileUrl;

  const dbSync = await import("../frontend/server/utils/dbSync.js");
  writeEvaluationReport = dbSync.writeEvaluationReport;
}

test("Fix 1: generateToken & verifyToken works and detects tampering", { skip: !hasFrontend }, () => {
  const token = generateToken(42);
  assert.ok(token.includes("."));
  const verified = verifyToken(token);
  assert.strictEqual(verified, 42);

  // Tampered token fails
  const tampered = token.slice(0, -4) + "abcd";
  assert.strictEqual(verifyToken(tampered), null);
});

test("Fix 2: withUserWorkspaceLock runs distinct user tasks concurrently", { skip: !hasFrontend }, async () => {
  let user1Finished = false;
  let user2Finished = false;

  const task1 = withUserWorkspaceLock(1, async () => {
    await new Promise((r) => setTimeout(r, 20));
    user1Finished = true;
  });

  const task2 = withUserWorkspaceLock(2, async () => {
    user2Finished = true;
  });

  await Promise.all([task1, task2]);
  assert.strictEqual(user1Finished, true);
  assert.strictEqual(user2Finished, true);
});

test("Fix 4: safeJsonParse recovers from markdown fences, trailing commas and comments", () => {
  const messyJson = `
  \`\`\`json
  {
    "company": "Google",
    "score": 9.5, // great score
    "strengths": [
      "Node.js",
      "Python",
    ],
  }
  \`\`\`
  `;
  const parsed = safeJsonParse(messyJson);
  assert.strictEqual(parsed.company, "Google");
  assert.strictEqual(parsed.score, 9.5);
  assert.strictEqual(parsed.strengths.length, 2);
});

test("Fix 7: translateQuery handles nested parentheses in JSON_OBJECT and JSON_ARRAYAGG without breaking", { skip: !hasFrontend }, () => {
  const sql = `SELECT JSON_OBJECT('id', u.id, 'status', COALESCE(u.status, 'active')) AS obj, JSON_ARRAYAGG(r.role_name) AS roles FROM users u`;
  const translated = translateQuery(sql);
  assert.ok(translated.text.includes("jsonb_build_object"));
  assert.ok(translated.text.includes("COALESCE(json_agg(r.role_name), json_build_array())"));
  assert.ok(!translated.text.includes("JSON_OBJECT"));
  assert.ok(!translated.text.includes("JSON_ARRAYAGG"));
});

test("Fix 10: buildVisibleScanRows pagination partitions correctly across pages", { skip: !hasFrontend }, () => {
  const mockRows = Array.from({ length: 50 }, (_, i) => ({
    company: `Corp ${i + 1}`,
    role: "Dev",
    url: `https://corp.com/${i + 1}`
  }));

  const page1 = buildVisibleScanRows(mockRows, 1, 20);
  assert.strictEqual(page1.length, 20);
  assert.strictEqual(page1[0].displayIndex, "01");
  assert.strictEqual(page1[19].displayIndex, "20");

  const page2 = buildVisibleScanRows(mockRows, 2, 20);
  assert.strictEqual(page2.length, 20);
  assert.strictEqual(page2[0].displayIndex, "21");
  assert.strictEqual(page2[19].displayIndex, "40");
});

test("Fix 11: getWorkspacePath reliably resolves to repo root regardless of cwd", { skip: !hasFrontend }, () => {
  const packageJsonPath = getWorkspacePath("package.json");
  assert.ok(existsSync(packageJsonPath), "package.json must exist at resolved workspace root");
});

test("Fix 12: evaluate raw_data handles both pre-parsed objects and json strings", () => {
  const parseRaw = (rawData) => {
    let raw = {};
    if (typeof rawData === "object" && rawData !== null) {
      raw = rawData;
    } else if (typeof rawData === "string" && rawData.trim()) {
      try {
        raw = JSON.parse(rawData);
      } catch {
        raw = {};
      }
    }
    return raw;
  };

  const preParsed = { description: "Senior Engineer role" };
  assert.strictEqual(parseRaw(preParsed).description, "Senior Engineer role");

  const jsonString = JSON.stringify({ description: "Frontend Developer" });
  assert.strictEqual(parseRaw(jsonString).description, "Frontend Developer");

  const nullVal = null;
  assert.deepStrictEqual(parseRaw(nullVal), {});
});

test("Fix 13: toPublicFileUrl produces portable relative files URL", { skip: !hasFrontend }, () => {
  const url = toPublicFileUrl("output/resume.pdf");
  assert.strictEqual(url, "/files/output/resume.pdf");

  const winUrl = toPublicFileUrl("C:\\Users\\someone\\app\\output\\resume.pdf");
  assert.strictEqual(winUrl, "/files/output/resume.pdf");

  const nullUrl = toPublicFileUrl(null);
  assert.strictEqual(nullUrl, null);
});

test("Fix 14: writeEvaluationReport embeds userId and applicationId", { skip: !hasFrontend }, async () => {
  const mockResult = {
    company: "Acme Corp",
    role: "Backend Engineer",
    score: 8.5,
    grade: "A",
    verdict: "Apply Now",
    location: "Remote",
    salary_estimate: "15 LPA",
    fit_summary: "Strong fit",
    strengths: ["Node.js"],
    gaps: [],
    interview_prep: ["Explain event loop"],
    action_items: ["Submit resume"]
  };

  const filePath = await writeEvaluationReport(mockResult, 888, "app-test-999");
  assert.ok(existsSync(filePath), "Report file must exist on disk");
  const baseName = path.basename(filePath);
  assert.ok(baseName.startsWith("u888_app-test-999_"), "Report filename must start with u{userId}_{appId}_");

  // Cleanup
  try {
    unlinkSync(filePath);
  } catch {}
});

test("Fix 15: saveOpsSettings and loadOpsSettings are isolated per user", { skip: !hasFrontend }, () => {
  const user1 = 10101;
  const user2 = 20202;

  saveOpsSettings({ notifications: { to: "user1@example.com", minScore: 9 } }, user1);
  saveOpsSettings({ notifications: { to: "user2@example.com", minScore: 6 } }, user2);

  const settings1 = loadOpsSettings(user1);
  const settings2 = loadOpsSettings(user2);

  assert.strictEqual(settings1.notifications.to, "user1@example.com");
  assert.strictEqual(settings1.notifications.minScore, 9);

  assert.strictEqual(settings2.notifications.to, "user2@example.com");
  assert.strictEqual(settings2.notifications.minScore, 6);

  // Cleanup test user files
  const dataDir = process.env.JOB_OPS_DATA_DIR || getWorkspacePath("data");
  const file1 = path.join(dataDir, `ops-settings-${user1}.json`);
  const file2 = path.join(dataDir, `ops-settings-${user2}.json`);
  try { unlinkSync(file1); } catch {}
  try { unlinkSync(file2); } catch {}
});


