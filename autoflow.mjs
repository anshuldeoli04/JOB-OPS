#!/usr/bin/env node
/**
 * JOB-OPS AutoFlow v4 (Interactive Human-in-the-Loop Pipeline)
 *
 * One trigger:
 *   1. Scan -> Checkpoint 1 (Review & Confirm AI Eval)
 *   2. Evaluate -> Checkpoint 2 (Matrix & Tailor Selected Resumes)
 *   3. Deliver PDF / HTML & Clickable Application Cards
 */

import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { backupIfNeeded, loadApplications } from "./config-utils.mjs";
import { loadScanResultsFromDb } from "./src/storage/db.mjs";
import { logger } from "./logger.mjs";
import {
  parseArgs,
  isInteractive,
  runManagedScript,
  summarizeGrades,
  renderCandidatesTable,
  printStrongMatchSummary,
  truncate,
} from "./src/services/autoflowDisplay.mjs";

export async function main() {
  console.clear();
  logger.info("============================================================");
  logger.info("                 JOB-OPS AutoFlow v4");
  logger.info("       Interactive AI Job Search & Auto-Tailoring");
  logger.info("============================================================\n");

  const options = parseArgs();
  const interactiveSession = isInteractive(options);
  backupIfNeeded();
  const beforeApps = loadApplications();
  const failures = [];
  let hadQuotaExhaustion = false;

  // STEP 1: Scan
  if (!options.skipScan) {
    const scannerArgs = ["--non-interactive", "--skip-evaluate-prompt"];
    if (options.sources) scannerArgs.push(`--sources=${options.sources}`);
    if (options.keywords) scannerArgs.push(`--keywords=${options.keywords}`);

    logger.info("1. Running scanner across configured sources...");
    const scannerCode = await runManagedScript("scanner.mjs", scannerArgs);
    if (scannerCode !== 0) {
      failures.push(`scanner.mjs exited with code ${scannerCode}`);
      logger.warn("Scanner reported warnings, proceeding with existing pending jobs.");
    }
  } else {
    logger.info("1. Scanner step skipped (--skip-scan).");
  }

  // CHECKPOINT 1: Post-Scan Review & Evaluation Confirmation
  const scanResults = loadScanResultsFromDb();
  const pendingJobs = scanResults.filter((r) => r.status === "new" || r.status === "pending");
  let shouldEvaluate = pendingJobs.length > 0;
  let evalLimit = options.limit;

  if (pendingJobs.length === 0) {
    logger.info("ℹ No new pending jobs found for evaluation.");
  } else {
    logger.info(`\n✔ Scanner stage complete.`);
    logger.info(`📊 Summary: ${scanResults.length} total jobs in scan database, ${pendingJobs.length} new jobs eligible for AI evaluation.`);

    if (interactiveSession && !options.autoConfirm) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        console.log(`\n? Evaluate candidates with AI? (Limit: ${evalLimit})`);
        console.log("   [Y] Yes, proceed (default)\n   [N] No, skip evaluation and review existing jobs\n   [<number>] Change evaluation limit (e.g. 5, 10, 20)");
        const answer = (await rl.question(" > Enter choice [Y/n/number]: ")).trim().toLowerCase();
        if (answer === "n" || answer === "no") {
          shouldEvaluate = false;
          logger.info("⏭️ Skipped AI evaluation per user request.");
        } else if (/^\d+$/.test(answer)) {
          evalLimit = parseInt(answer, 10);
          logger.info(`🔧 Evaluation limit set to ${evalLimit}`);
        }
      } finally {
        rl.close();
      }
    }
  }

  // STEP 2: Evaluation
  if (shouldEvaluate && pendingJobs.length > 0) {
    logger.info(`\n2. Evaluating quick-filtered jobs (limit: ${evalLimit})...`);
    const evaluatorCode = await runManagedScript("scan-evaluate.mjs", [
      "--non-interactive", "--mode=auto", `--limit=${evalLimit}`,
    ]);
    if (evaluatorCode === 2) {
      failures.push("scan-evaluate.mjs hit provider daily quota (exit code 2). Remaining jobs kept as pending.");
      hadQuotaExhaustion = true;
    } else if (evaluatorCode !== 0) {
      failures.push(`scan-evaluate.mjs exited with code ${evaluatorCode}`);
      logger.warn("Batch evaluator encountered errors. Summarizing available evaluated data.");
    }
  }

  // CHECKPOINT 2: Result Table & Interactive Resume Selection
  const afterEvaluationApps = loadApplications();
  const newlyEvaluated = afterEvaluationApps.filter((app) => !beforeApps.some((old) => old.id === app.id));
  const newStrongMatches = newlyEvaluated.filter((app) => options.strongGrades.includes(app.grade));

  let candidatePool = [];
  if (newStrongMatches.length > 0) candidatePool = [...newStrongMatches];
  else if (newlyEvaluated.length > 0) candidatePool = [...newlyEvaluated];
  else candidatePool = afterEvaluationApps.filter((app) => options.strongGrades.includes(app.grade) && !app.resume_pdf);

  candidatePool.sort((a, b) => {
    const order = { A: 1, B: 2, C: 3, D: 4, F: 5 };
    const diff = (order[a.grade] || 9) - (order[b.grade] || 9);
    if (diff !== 0) return diff;
    return (b.score || 0) - (a.score || 0);
  });

  let selectedToTailor = [];
  if (candidatePool.length > 0) {
    logger.info(`\n3. ${candidatePool.length} match candidates found.`);
    renderCandidatesTable(candidatePool);

    if (interactiveSession && !options.autoConfirm) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        console.log("? Select jobs to generate customized PDF resumes:");
        console.log("   [a]        All Grade A candidates\n   [ab]       All Grade A & B candidates\n   [1, 2, ..] Specific job numbers by # in the table above\n   [s]        Skip resume generation (review only)");
        const answer = (await rl.question("\n > Enter selection [default: a]: ")).trim().toLowerCase() || "a";
        if (answer === "s" || answer === "skip") selectedToTailor = [];
        else if (answer === "a") {
          selectedToTailor = candidatePool.filter((j) => j.grade === "A");
          if (selectedToTailor.length === 0) selectedToTailor = candidatePool.filter((j) => j.grade === "B");
        } else if (answer === "ab" || answer === "b") {
          selectedToTailor = candidatePool.filter((j) => j.grade === "A" || j.grade === "B");
        } else {
          const indices = answer.split(/[,\s]+/).map((n) => parseInt(n.trim(), 10) - 1)
            .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < candidatePool.length);
          selectedToTailor = indices.map((idx) => candidatePool[idx]);
        }
      } finally {
        rl.close();
      }
    } else {
      if (options.autoTailor || options.autoConfirm) {
        let pool = candidatePool.filter((j) => j.grade === "A");
        if (pool.length === 0 && options.autoConfirm) pool = candidatePool.filter((j) => j.grade === "B");
        selectedToTailor = pool.slice(0, options.tailorTop || 3);
      }
    }
  } else {
    logger.info("\n3. No new matching candidates found.");
  }

  // STEP 3: Resume Tailoring
  if (selectedToTailor.length > 0) {
    console.log(`\n📄 Generating tailored resume for ${selectedToTailor.length} selected job(s)...`);
    for (const job of selectedToTailor) {
      console.log(`\n⏳ Tailoring resume for ${job.company} — ${job.role} (ID: ${job.id})...`);
      const code = await runManagedScript("resume-builder.mjs", [`--job-id=${job.id}`]);
      if (code !== 0) logger.warn(`Resume builder failed for ${job.company} with code ${code}`);
    }

    const freshApps = loadApplications();
    console.log("\n" + "═".repeat(70) + "\n               TAILORED APPLICATION PACKAGES\n" + "═".repeat(70));
    for (const job of selectedToTailor) {
      const updated = freshApps.find((a) => a.id === job.id) || job;
      const resumePath = updated.resume_pdf || updated.resume_html;
      const fileUrl = resumePath ? `file:///${path.resolve(resumePath).replace(/\\/g, "/")}` : "Not generated (check logs)";
      const applyUrl = updated.apply_url || updated.url || "N/A";
      console.log(`──────────────────────────────────────────────────────────────────`);
      console.log(`✅ ${updated.company} — ${updated.role} [Grade ${updated.grade || "?"}, Score ${updated.score || "?"}]`);
      console.log(`   📄 Tailored Resume : ${fileUrl}\n   🔗 Direct Apply    : ${applyUrl}`);
      if (updated.fit_summary) console.log(`   💡 Fit Summary     : ${truncate(updated.fit_summary, 85)}`);
    }
    console.log("──────────────────────────────────────────────────────────────────\n");
  } else if (candidatePool.length > 0) {
    printStrongMatchSummary(candidatePool);
  }

  // FINAL SUMMARY
  const finalApps = loadApplications();
  const newApps = finalApps.filter((app) => !beforeApps.some((oldApp) => oldApp.id === app.id));
  const gradedSummary = summarizeGrades(newApps);
  logger.info("\n============================================================");
  logger.info("AutoFlow complete");
  logger.info(`New tracked jobs    : ${newApps.length}`);
  logger.info(`Strong matches      : ${newStrongMatches.length}`);
  logger.info(`Resumes generated   : ${selectedToTailor.length}`);
  logger.info(`Grades breakdown    : A=${gradedSummary.A || 0}, B=${gradedSummary.B || 0}, C=${gradedSummary.C || 0}, D=${gradedSummary.D || 0}, F=${gradedSummary.F || 0}`);
  logger.info("============================================================");

  if (failures.length > 0) {
    logger.warn("\nWarnings:");
    failures.forEach((f) => logger.warn(`- ${f}`));
  }
  logger.info("\nDashboard data is updated in data/applications.json");
  logger.info("Run `npm run start` or `node autoflow.mjs` anytime for a fresh run.\n");

  if (hadQuotaExhaustion) {
    logger.info("Pipeline paused due to provider quota limits. Run again tomorrow or switch keys.\n");
    return { ok: true, quotaExhausted: true };
  }
  return { ok: true };
}

process.on("SIGINT", () => {
  console.log("\n🛑 AutoFlow interrupted by user. Exiting cleanly (exit code 2)...");
  process.exit(2);
});

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().then((result) => {
    if (result?.quotaExhausted) process.exit(2);
    process.exit(0);
  }).catch((error) => {
    logger.error(`AutoFlow failed: ${error.message}`);
    process.exit(error?.isQuotaExhausted || error?.name === "QuotaExhaustedError" ? 2 : 1);
  });
}
