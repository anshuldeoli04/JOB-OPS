/**
 * JOB-OPS Evaluator
 * Free job evaluation using Gemini 2.5 Flash API
 * Usage: node evaluate.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import {
  backupIfNeeded,
  generateApplicationId,
  getExperienceProfile,
  loadConfig,
  loadCVWithCache,
  sanitizeFileStem,
  upsertApplication,
  validateEvaluation,
} from "./config-utils.mjs";
import { callLLM } from "./llm/llmClient.mjs";
import { buildDeepEvaluationPrompt } from "./llm/evalPrompt.mjs";
import { safeJsonParse } from "./llm/jsonUtils.mjs";
import { logger } from "./logger.mjs";

function extractRelevantJobUrl(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s)]+/gi) || [];
  if (matches.length === 0) return "";

  const cleaned = matches.map((url) => url.replace(/[.,;]+$/, ""));
  const priorityPatterns = [
    /apply/i,
    /jobs?/i,
    /careers?/i,
    /greenhouse/i,
    /lever/i,
    /wellfound/i,
    /naukri/i,
    /internshala/i,
  ];

  for (const pattern of priorityPatterns) {
    const matched = cleaned.find((url) => pattern.test(url));
    if (matched) return matched;
  }

  return cleaned[cleaned.length - 1];
}



async function getMultilineInput(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  logger.info(prompt);
  logger.info('(When finished pasting, type "DONE" on a new line and press Enter)');
  logger.info("-".repeat(60));
  return new Promise((resolve) => {
    const lines = [];
    rl.on("line", (line) => {
      if (line.trim() === "DONE") {
        rl.close();
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    });
  });
}

function displayResult(result) {
  const gradeColors = { A: "[A]", B: "[B]", C: "[C]", D: "[D]", F: "[F]" };
  const verdictIcon = {
    "Apply Now": "[OK]",
    "Apply With Prep": "[PREP]",
    "Apply Carefully": "[WARN]",
    Skip: "[SKIP]",
  };

  logger.info("\n" + "=".repeat(60));
  logger.info(`${gradeColors[result.grade] || "[ ]"} GRADE: ${result.grade}  |  SCORE: ${result.score}/10`);
  logger.info(`${verdictIcon[result.verdict] || "[INFO]"} VERDICT: ${result.verdict}`);
  logger.info("=".repeat(60));
  logger.info(`Company : ${result.company}`);
  logger.info(`Role    : ${result.role}`);
  logger.info(`Location: ${result.location}`);
  logger.info(`Salary  : ${result.salary_estimate}`);
  logger.info("-".repeat(60));
  logger.info(`FIT SUMMARY:\n   ${result.fit_summary}`);
  logger.info("-".repeat(60));

  if (result.strengths?.length) {
    logger.info("KEY STRENGTHS:");
    result.strengths.forEach((s) => logger.info(`   - ${s}`));
  }

  if (result.gaps?.length) {
    logger.info("\nSKILL GAPS:");
    result.gaps.forEach((g) => logger.info(`   - ${g}`));
  }

  if (result.cv_highlights?.length) {
    logger.info("\nRECOMMENDED RESUME HIGHLIGHTS:");
    result.cv_highlights.forEach((h) => logger.info(`   - ${h}`));
  }

  if (result.interview_prep?.length) {
    logger.info("\nINTERVIEW PREP:");
    result.interview_prep.forEach((q, i) => logger.info(`   ${i + 1}. ${q}`));
  }

  if (result.negotiation_note) {
    logger.info(`\nSALARY NEGOTIATION TIP:\n   ${result.negotiation_note}`);
  }

  if (result.action_items?.length) {
    logger.info("\nNEXT STEPS:");
    result.action_items.forEach((a, i) => logger.info(`   ${i + 1}. ${a}`));
  }

  logger.info("=".repeat(60));
}
function saveReport(result, jobUrl = "") {
  const id = generateApplicationId();
  const timestamp = new Date().toISOString();
  const reportDir = "./reports";
  fs.mkdirSync(reportDir, { recursive: true });

  const userId = process.env.JOB_OPS_USER_ID || "1";
  const userPrefix = `u${userId}_`;
  const reportFile = path.join(reportDir, `${userPrefix}${sanitizeFileStem(result.company, "company")}_${id}.md`);
  const reportContent = `# ${result.company} - ${result.role}
**Date:** ${timestamp}
**Score:** ${result.score}/10 (${result.grade})
**Verdict:** ${result.verdict}
**Location:** ${result.location}
**Salary Estimate:** ${result.salary_estimate}

## Fit Summary
${result.fit_summary}

## Strengths
${result.strengths?.map((s) => `- ${s}`).join("\n")}

## Gaps
${result.gaps?.map((g) => `- ${g}`).join("\n")}

## CV Highlights for This Role
${result.cv_highlights?.map((h) => `- ${h}`).join("\n")}

## Interview Prep
${result.interview_prep?.map((q, i) => `${i + 1}. ${q}`).join("\n")}

## Negotiation Note
${result.negotiation_note}

## Next Steps
${result.action_items?.map((a, i) => `${i + 1}. ${a}`).join("\n")}

---
*JOB-OPS Free System | ${timestamp}*
`;
  fs.writeFileSync(reportFile, reportContent);

  const application = {
    id,
    timestamp,
    company: result.company,
    role: result.role,
    location: result.location,
    url: jobUrl || null,
    apply_url: jobUrl || null,
    salary_estimate: result.salary_estimate,
    score: result.score,
    grade: result.grade,
    verdict: result.verdict,
    evaluated_by: result.evaluated_by || "gemini",
    status: "evaluated",
    report_file: reportFile,
  };
  upsertApplication(application);
  return { id: application.id, reportFile };
}

async function main() {
  console.clear();
  logger.info("============================================================");
  logger.info("          JOB-OPS - Free AI Job Evaluator");
  logger.info("       Powered by Google Gemini (Free Tier)");
  logger.info("============================================================\n");

  let config;
  let cv;
  let experienceProfile;
  try {
    config = loadConfig();
    cv = loadCVWithCache();
    experienceProfile = getExperienceProfile(config);
    backupIfNeeded();
  } catch (error) {
    logger.error(`${error.message}`);
    process.exit(1);
  }

  logger.info("Paste Job Description (copied from the target job posting or careers page)");
  const jd = await getMultilineInput("\n");

  if (!jd || jd.trim().length < 50) {
    logger.error("Job description is too short. Please provide the full job description.");
    process.exit(1);
  }

  const detectedJobUrl = extractRelevantJobUrl(jd);
  let normalizedJobUrl = detectedJobUrl;
  if (!normalizedJobUrl) {
    const urlInput = await getMultilineInput("Job URL is optional. Paste it on a new line or type DONE to skip:");
    normalizedJobUrl = String(urlInput || "").split(/\s+/).find((token) => /^https?:\/\//i.test(token)) || "";
  }

  logger.info("\nEvaluating job fit via routed LLM (Gemini primary)... (10-20 seconds)\n");

  try {
    const prompt = buildDeepEvaluationPrompt(jd, cv, experienceProfile);
    const response = await callLLM("score_job", [{ role: "user", content: prompt }], {
      config,
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseFormat: { type: "json_object" },
      allowGroqFallback: false,
    });
    const rawText = response?.text || String(response);
    const result = validateEvaluation(safeJsonParse(rawText), {
      provider: response?.provider,
      model: response?.model,
      evaluated_by: response?.provider ? `${response.provider}/${response.model}` : "gemini",
    });

    displayResult(result);

    const { id, reportFile } = saveReport(result, normalizedJobUrl);
    logger.info(`\nReport saved: ${reportFile}`);
    logger.info(`Tracker updated (ID: ${id})`);
    logger.info("\nTo view all tracked applications: node tracker.mjs\n");
  } catch (err) {
    if (err instanceof SyntaxError) {
      logger.error("Failed to parse Gemini response JSON. Please retry.");
    } else {
      logger.error(`Error: ${err.message}`);
      if (err.message?.includes("API_KEY")) {
        logger.error("-> Please verify GEMINI_API_KEY in your .env file.");
      }
    }
    process.exit(1);
  }
}

export { main };

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main();
}

