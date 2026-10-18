import { runNodeScript } from "../../process-runner.mjs";
import { logger } from "../../logger.mjs";

const DEFAULT_STRONG_GRADES = ["A", "B"];
const SUBPROCESS_TIMEOUT_MS = 10 * 60 * 1000;

export function parseArgs(argv = process.argv.slice(2)) {
  const sources = argv.find((a) => a.startsWith("--sources="))?.split("=")[1];
  const keywords = argv.find((a) => a.startsWith("--keywords="))?.split("=")[1];
  const strongGrades =
    argv.find((a) => a.startsWith("--strong-grades="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--resume-grades="))?.split("=")[1];

  const limitArg = argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const limit = limitArg ? parseInt(limitArg, 10) : 12;

  const tailorTopArg = argv.find((a) => a.startsWith("--tailor-top="))?.split("=")[1];
  const tailorTop = tailorTopArg ? parseInt(tailorTopArg, 10) : 3;

  const autoConfirm = argv.includes("--yes") || argv.includes("-y");
  const skipScan = argv.includes("--skip-scan");
  const autoTailor = argv.includes("--auto-tailor");
  const ci =
    argv.includes("--ci") ||
    argv.includes("--headless") ||
    argv.includes("--non-interactive") ||
    Boolean(process.env.CI);

  return {
    sources,
    keywords,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 12,
    tailorTop: Number.isFinite(tailorTop) && tailorTop > 0 ? tailorTop : 3,
    strongGrades: strongGrades
      ? strongGrades.split(",").map((g) => g.trim().toUpperCase()).filter(Boolean)
      : DEFAULT_STRONG_GRADES,
    autoConfirm,
    skipScan,
    autoTailor,
    ci,
  };
}

export function isInteractive(options) {
  if (options.ci) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  return true;
}

export async function runManagedScript(script, extraArgs = []) {
  const result = await runNodeScript(script, extraArgs, {
    timeoutMs: SUBPROCESS_TIMEOUT_MS,
    onTimeout: () => {
      logger.warn(`${script} timed out after ${Math.round(SUBPROCESS_TIMEOUT_MS / 60000)} minutes, continuing...`);
    },
  });
  return typeof result === "object" && result !== null ? result.code : result;
}

export function getNewStrongMatches(beforeApps, afterApps, strongGrades) {
  const beforeIds = new Set(beforeApps.map((app) => app.id));
  return afterApps.filter((app) => !beforeIds.has(app.id) && strongGrades.includes(app.grade));
}

export function summarizeGrades(apps) {
  return apps.reduce((acc, app) => {
    const grade = app.grade || "?";
    acc[grade] = (acc[grade] || 0) + 1;
    return acc;
  }, {});
}

export function truncate(str, max) {
  const s = String(str || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

export function renderCandidatesTable(jobs) {
  const line = "═".repeat(96);
  console.log("\n" + line);
  console.log(
    ` ${"#".padEnd(3)} | ${"Company".padEnd(20)} | ${"Role".padEnd(30)} | ${"Grade".padEnd(5)} | ${"Score".padEnd(8)} | Recommendation / Action`
  );
  console.log(line);

  jobs.forEach((app, i) => {
    const num = String(i + 1).padStart(2);
    const co = truncate(app.company || "Unknown", 20).padEnd(20);
    const role = truncate(app.role || "Unknown", 30).padEnd(30);
    const grade = (app.grade || "?").padEnd(5);
    const scoreVal = app.score !== undefined ? `${app.score}` : "N/A";
    const score = truncate(scoreVal, 8).padEnd(8);
    const verdict = truncate(
      app.verdict || (app.grade === "A" ? "Apply Immediately" : "Apply with Prep"),
      24
    );

    console.log(` ${num}  | ${co} | ${role} | ${grade} | ${score} | ${verdict}`);
  });
  console.log(line + "\n");
}

export function printStrongMatchSummary(strongMatches) {
  if (strongMatches.length === 0) return;
  logger.info("\nTop apply-now/apply-with-prep jobs:");
  strongMatches.forEach((app, index) => {
    const applyLink = app.apply_url || app.url || "N/A";
    logger.info(`${index + 1}. ${app.company} - ${app.role} [${app.grade}]`);
    logger.info(`   Job ID: ${app.id}`);
    logger.info(`   Apply: ${applyLink}`);
    logger.info(`   Resume: node resume-builder.mjs --job-id=${app.id}`);
  });
}
