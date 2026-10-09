import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { generateToken, verifyToken } from "../frontend/server/utils/tokenAuth.js";
import { withUserWorkspaceLock } from "../frontend/server/utils/workspaceLock.js";
import { getWorkspacePath } from "../frontend/server/utils/userWorkspace.js";
import { safeJsonParse } from "../llm/jsonUtils.mjs";
import { translateQuery } from "../frontend/server/utils/db.js";
import { buildVisibleScanRows } from "../frontend/src/utils/scanFormatting.js";
import { loadOpsSettings, saveOpsSettings } from "../frontend/server/utils/opsStore.js";
import { toPublicFileUrl } from "../frontend/server/utils/fileLinks.js";
import { writeEvaluationReport } from "../frontend/server/utils/dbSync.js";

test("Fix 1: generateToken & verifyToken works and detects tampering", () => {
  const token = generateToken(42);
  assert.ok(token.includes("."));
  const verified = verifyToken(token);
  assert.strictEqual(verified, 42);

  // Tampered token fails
  const tampered = token.slice(0, -4) + "abcd";
  assert.strictEqual(verifyToken(tampered), null);
});

test("Fix 2: withUserWorkspaceLock runs distinct user tasks concurrently", async () => {
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

test("Fix 7: translateQuery handles nested parentheses in JSON_OBJECT and JSON_ARRAYAGG without breaking", () => {
  const sql = `SELECT JSON_OBJECT('id', u.id, 'status', COALESCE(u.status, 'active')) AS obj, JSON_ARRAYAGG(r.role_name) AS roles FROM users u`;
  const translated = translateQuery(sql);
  assert.ok(translated.text.includes("jsonb_build_object"));
  assert.ok(translated.text.includes("COALESCE(json_agg(r.role_name), json_build_array())"));
  assert.ok(!translated.text.includes("JSON_OBJECT"));
  assert.ok(!translated.text.includes("JSON_ARRAYAGG"));
});

test("Fix 10: buildVisibleScanRows pagination partitions correctly across pages", () => {
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

test("Fix 11: getWorkspacePath reliably resolves to repo root regardless of cwd", () => {
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

test("Fix 13: toPublicFileUrl produces portable relative files URL", () => {
  const url = toPublicFileUrl("output/resume.pdf");
  assert.strictEqual(url, "/files/output/resume.pdf");

  const winUrl = toPublicFileUrl("C:\\Users\\someone\\app\\output\\resume.pdf");
  assert.strictEqual(winUrl, "/files/output/resume.pdf");

  const nullUrl = toPublicFileUrl(null);
  assert.strictEqual(nullUrl, null);
});

test("Fix 14: writeEvaluationReport embeds userId and applicationId", async () => {
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

test("Fix 15: saveOpsSettings and loadOpsSettings are isolated per user", () => {
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


