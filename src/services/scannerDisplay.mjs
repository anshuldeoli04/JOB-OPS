import fs from "fs";
import { SCAN_RESULTS_FILE, HEALTH_LOG_FILE } from "../config/configPaths.mjs";
import { logger } from "../../logger.mjs";
import { HEALTH } from "../../health.mjs";

export function displayResults(newJobs = [], funnelStats = {}, showFiltered = false) {
  const sources = Object.keys(funnelStats);
  if (sources.length > 0) {
    logger.info(`\n${"=".repeat(95)}`);
    logger.info("SCAN FUNNEL BREAKDOWN");
    logger.info("=".repeat(95));
    const pad = (s, w) => String(s || "").padEnd(w);
    const padNum = (n, w) => String(n || 0).padStart(w);

    logger.info(
      `${pad("Source", 15)} | ${pad("Health", 18)} | ${padNum("Raw", 6)} | ${padNum("Filtered", 8)} | ${padNum("Within-Dedup", 12)} | ${padNum("Cross-Dedup", 11)} | ${padNum("NEW", 6)}`
    );
    logger.info("-".repeat(95));

    const totals = { raw: 0, filtered: 0, withinDedup: 0, crossDedup: 0, new: 0 };
    for (const src of sources) {
      const s = funnelStats[src];
      totals.raw += s.raw || 0;
      totals.filtered += s.filtered || 0;
      totals.withinDedup += s.withinDedup || 0;
      totals.crossDedup += s.crossDedup || 0;
      totals.new += s.new || 0;

      const health = s.healthStatus || (logger.warn(`   ${src}: health not reported (bug)`), HEALTH.ERROR);

      logger.info(
        `${pad(src, 15)} | ${pad(health, 18)} | ${padNum(s.raw, 6)} | ${padNum(s.filtered, 8)} | ${padNum(s.withinDedup, 12)} | ${padNum(s.crossDedup, 11)} | ${padNum(s.new, 6)}`
      );

      try {
        const logEntry = JSON.stringify({
          ts: new Date().toISOString(),
          source: src,
          state: health,
          raw: s.raw || 0,
          filtered: s.filtered || 0,
        });
        fs.appendFileSync(HEALTH_LOG_FILE, logEntry + "\n", "utf8");
      } catch (err) {
        logger.warn(`Could not append to health-log.jsonl: ${err.message}`);
      }
    }
    logger.info("-".repeat(95));
    logger.info(
      `${pad("TOTAL", 15)} | ${pad("-", 18)} | ${padNum(totals.raw, 6)} | ${padNum(totals.filtered, 8)} | ${padNum(totals.withinDedup, 12)} | ${padNum(totals.crossDedup, 11)} | ${padNum(totals.new, 6)}`
    );
    logger.info("=".repeat(95));
  }

  const visibleJobs = showFiltered ? newJobs : newJobs.filter((j) => j.quick_filter !== "fail");
  const filteredCount = newJobs.length - visibleJobs.length;

  if (visibleJobs.length === 0 && newJobs.length === 0) {
    logger.info("\n0 new jobs found (all were duplicates or previously scanned).");
    return;
  }

  logger.info(`\n${"=".repeat(75)}`);
  if (filteredCount > 0 && !showFiltered) {
    logger.info(`${visibleJobs.length} NEW JOBS FOUND (${filteredCount} non-target/filtered hidden, use --show-filtered to view)`);
  } else {
    logger.info(`${visibleJobs.length} NEW JOBS FOUND`);
  }
  logger.info("=".repeat(75));

  const bySource = {};
  visibleJobs.forEach((r) => {
    if (!bySource[r.source]) bySource[r.source] = [];
    bySource[r.source].push(r);
  });

  Object.entries(bySource).forEach(([source, jobs]) => {
    logger.info(`\n${source.toUpperCase()} (${jobs.length})`);
    jobs.forEach((job, i) => {
      logger.info(`   ${i + 1}. ${job.role} @ ${job.company}`);
      logger.info(`      ${job.location || "Location not specified"}${job.salary ? " | " + job.salary : ""}`);
      if (job.url) logger.info(`      ${job.url}`);
    });
  });

  logger.info(`\n${"=".repeat(75)}`);
  logger.info(`Saved to: ${SCAN_RESULTS_FILE}`);
  logger.info(`\nTo evaluate any discovered job:`);
  logger.info(`   node evaluate.mjs       (paste Job Description or URL)`);
  logger.info(`   node scan-evaluate.mjs  (select from scan results)\n`);
}
