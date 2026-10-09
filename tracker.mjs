/**
 * JOB-OPS Tracker
 * View and manage evaluated job applications.
 * Usage: node tracker.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { APPLICATIONS_FILE, loadApplications, withFileLockSync, writeJsonFileAtomic } from "./config-utils.mjs";

const PAGE_SIZE = 15;
const TABLE_WIDTH = 108;

function gradeLabel(grade) {
  const labels = { A: "[A]", B: "[B]", C: "[C]", D: "[D]", F: "[F]" };
  return labels[grade] || "[?]";
}

function statusLabel(status) {
  const labels = {
    evaluated: "[eval]",
    applied: "[applied]",
    interview: "[interview]",
    offer: "[offer]",
    rejected: "[rejected]",
    withdrawn: "[withdrawn]",
  };
  return labels[status] || "[eval]";
}

function safeDate(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-IN");
}

function truncate(value, width) {
  const text = String(value || "?");
  if (text.length <= width) return text.padEnd(width);
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}...`;
}

function getSortedApps(apps, gradeFilter) {
  const filtered = gradeFilter ? apps.filter((app) => app.grade === gradeFilter) : apps;
  return [...filtered].sort((a, b) => (b.score || 0) - (a.score || 0));
}

function displayTable(apps, page = 1, gradeFilter = null) {
  console.clear();
  console.log("=".repeat(TABLE_WIDTH));
  console.log("JOB-OPS - Application Tracker");
  console.log("=".repeat(TABLE_WIDTH));

  const sorted = getSortedApps(apps, gradeFilter);
  if (sorted.length === 0) {
    console.log("No applications found.\n");
    return;
  }

  const total = apps.length;
  const applied = apps.filter((a) => ["applied", "interview", "offer"].includes(a.status)).length;
  const interviews = apps.filter((a) => a.status === "interview").length;
  const offers = apps.filter((a) => a.status === "offer").length;
  const scoredApps = apps.filter((a) => Number.isFinite(Number(a.score)));
  const avgScore = scoredApps.length
    ? (scoredApps.reduce((sum, a) => sum + Number(a.score), 0) / scoredApps.length).toFixed(1)
    : "-";
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(startIndex, startIndex + PAGE_SIZE);

  console.log(`SUMMARY: ${total} evaluated | ${applied} applied | ${interviews} interviews | ${offers} offers | Avg Score: ${avgScore}/10`);
  if (gradeFilter) {
    console.log(`Filter: Grade ${gradeFilter} | Showing ${sorted.length} matching applications`);
  }
  console.log(`Page ${currentPage}/${totalPages} | Showing ${pageItems.length} of ${sorted.length}`);
  console.log("-".repeat(TABLE_WIDTH));
  console.log(
    "# ".padEnd(4) +
      "Grade".padEnd(8) +
      "Score".padEnd(7) +
      "Company".padEnd(22) +
      "Role".padEnd(28) +
      "Status".padEnd(16) +
      "Location"
  );
  console.log("-".repeat(TABLE_WIDTH));

  pageItems.forEach((app, index) => {
    const grade = `${gradeLabel(app.grade)} ${app.grade || "?"}`;
    const score = String(app.score || "?").padEnd(7);
    const company = truncate(app.company || "Unknown", 20).padEnd(22);
    const role = truncate(app.role || "Unknown", 26).padEnd(28);
    const status = truncate(`${statusLabel(app.status)} ${app.status || "?"}`, 14).padEnd(16);
    const location = truncate(app.location || "?", 24);

    console.log(
      String(startIndex + index + 1).padEnd(4) +
        grade.padEnd(8) +
        score +
        company +
        role +
        status +
        location
    );
  });

  console.log("-".repeat(TABLE_WIDTH));
}

function displayDetail(app) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${gradeLabel(app.grade)} ${app.company} - ${app.role}`);
  console.log("=".repeat(60));
  console.log(`Score    : ${app.score}/10 (${app.grade})`);
  console.log(`Status   : ${statusLabel(app.status)} ${app.status}`);
  console.log(`Location : ${app.location}`);
  console.log(`Salary   : ${app.salary_estimate || "Not estimated"}`);
  console.log(`Date     : ${safeDate(app.timestamp)}`);
  console.log(`Verdict  : ${app.verdict}`);
  if (app.report_file && fs.existsSync(app.report_file)) {
    console.log(`\nFull report: ${app.report_file}`);
  }
  console.log("=".repeat(60));
}

function saveApplicationStatus(appId, status) {
  return withFileLockSync(APPLICATIONS_FILE, () => {
    const latestApps = loadApplications();
    const idx = latestApps.findIndex((app) => app.id === appId);
    if (idx < 0) return null;
    latestApps[idx].status = status;
    writeJsonFileAtomic(APPLICATIONS_FILE, latestApps, { lock: false });
    return latestApps;
  });
}

async function updateStatus(app) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const statuses = ["evaluated", "applied", "interview", "offer", "rejected", "withdrawn"];

  console.log("\nUpdate application status:");
  statuses.forEach((status, i) => console.log(`   ${i + 1}. ${statusLabel(status)} ${status}`));

  return new Promise((resolve) => {
    rl.question("\nEnter selection number: ", (answer) => {
      rl.close();
      const choice = parseInt(answer, 10) - 1;
      if (choice >= 0 && choice < statuses.length) {
        const updatedApps = saveApplicationStatus(app.id, statuses[choice]);
        if (!updatedApps) {
          console.log("Application not found. Data may have changed; reload tracker.");
          resolve(null);
          return;
        }
        console.log(`Status updated to: ${statuses[choice]}`);
        resolve(updatedApps);
        return;
      }
      console.log("Invalid choice");
      resolve(null);
    });
  });
}

async function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  let apps = loadApplications();
  if (apps.length === 0) {
    console.log("\nNo tracked applications found yet. Run node evaluate.mjs or node scan-evaluate.mjs first.\n");
    return;
  }

  let currentPage = 1;
  let gradeFilter = null;
  displayTable(apps, currentPage, gradeFilter);

  console.log("\nOptions:");
  console.log("  - View details          -> enter application number (e.g. 1)");
  console.log("  - Update status         -> 'u' then enter number");
  console.log("  - Next / previous page  -> 'n' / 'p'");
  console.log("  - Filter by grade       -> 'A', 'B', 'C', 'D', 'F' | clear filter -> 'all'");
  console.log("  - Exit                  -> 'q'");

  while (true) {
    const input = await askQuestion("\n> ");
    const normalizedInput = input.toLowerCase();

    if (normalizedInput === "q") break;
    if (normalizedInput === "n") {
      const totalPages = Math.max(1, Math.ceil(getSortedApps(apps, gradeFilter).length / PAGE_SIZE));
      currentPage = Math.min(currentPage + 1, totalPages);
      displayTable(apps, currentPage, gradeFilter);
      continue;
    }

    if (normalizedInput === "p") {
      currentPage = Math.max(currentPage - 1, 1);
      displayTable(apps, currentPage, gradeFilter);
      continue;
    }

    if (normalizedInput === "u") {
      const numStr = await askQuestion("Select application to update status (number): ");
      const num = parseInt(numStr, 10) - 1;
      const sorted = getSortedApps(apps, gradeFilter);
      if (num >= 0 && num < sorted.length) {
        const updatedApps = await updateStatus(sorted[num]);
        if (updatedApps) apps = updatedApps;
        displayTable(apps, currentPage, gradeFilter);
      }
      continue;
    }

    if (["a", "b", "c", "d", "f"].includes(normalizedInput)) {
      gradeFilter = normalizedInput.toUpperCase();
      currentPage = 1;
      displayTable(apps, currentPage, gradeFilter);
      continue;
    }

    if (normalizedInput === "all") {
      gradeFilter = null;
      currentPage = 1;
      displayTable(apps, currentPage, gradeFilter);
      continue;
    }

    const num = parseInt(input, 10) - 1;
    const sorted = getSortedApps(apps, gradeFilter);
    if (num >= 0 && num < sorted.length) {
      displayDetail(sorted[num]);
    } else {
      console.log("Invalid input");
    }
  }

  console.log("\nTracker closed.\n");
}

export { main };

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main();
}
