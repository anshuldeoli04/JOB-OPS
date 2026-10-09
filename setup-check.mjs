/**
 * JOB-OPS Setup Checker
 * Checks all prerequisites and config
 */

import fs from "fs";
import { getConfigPaths, isPlaceholderCv, loadConfig } from "./config-utils.mjs";

console.log("\n🔍 JOB-OPS Setup Check\n");

let allGood = true;
function check(name, condition, fix, { optional = false } = {}) {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else if (optional) {
    console.log(`  ⚪ ${name} (Optional)`);
    if (fix) console.log(`     INFO: ${fix}`);
  } else {
    console.log(`  ❌ ${name}`);
    console.log(`     FIX: ${fix}`);
    allGood = false;
  }
}

function findConfigFile() {
  return getConfigPaths().find((file) => fs.existsSync(file));
}

const nodeVer = parseInt(process.version.slice(1), 10);
check("Node.js v20+", nodeVer >= 20, "Download the latest Node.js LTS (v20+) from nodejs.org");

const configFile = findConfigFile();
check(
  "Config file exists",
  Boolean(configFile),
  "Keep config.json as a template and set GEMINI_API_KEY in your .env file"
);

if (configFile) {
  try {
    const config = loadConfig({ requireApiKey: false });
    const rawConfig = JSON.parse(fs.readFileSync(configFile, "utf8"));

    check(
      "Gemini API key set",
      Boolean(process.env.GEMINI_API_KEY),
      "Obtain a free Gemini API key from aistudio.google.com and set GEMINI_API_KEY in .env"
    );
    check(
      "Groq API key set for fallback tasks",
      Boolean(process.env.GROQ_API_KEY),
      "Obtain an optional API key from console.groq.com and set GROQ_API_KEY in .env, or keep fallback disabled",
      { optional: true }
    );
    check(
      "Gemini model set",
      !config.gemini_model || typeof config.gemini_model === "string",
      "Set gemini_model to a valid string, e.g. gemini-2.5-flash"
    );
    if (configFile === "./config.json") {
      check(
        "config.json is safe template",
        !("gemini_api_key" in rawConfig) && !("groq_api_key" in rawConfig),
        "Remove API key fields from config.json; store real secrets in .env only"
      );
    }
  } catch {
    check("Config file valid JSON", false, "Verify valid JSON syntax in config.json / config.local.json");
  }
}

check("cv.md exists", fs.existsSync("./cv.md"), "Create cv.md and write your resume in Markdown format");

if (fs.existsSync("./cv.md")) {
  const cvContent = fs.readFileSync("./cv.md", "utf8");
  check(
    "cv.md has real content",
    cvContent.length > 200 && !isPlaceholderCv(cvContent),
    "Replace placeholder text in cv.md with your real experience, skills, and projects"
  );
}

check("data/ directory", true, "Auto-created");
fs.mkdirSync("./data", { recursive: true });
fs.mkdirSync("./reports", { recursive: true });
check("templates/ directory exists", fs.existsSync("./templates"), "Keep the templates folder in the project root");
check(
  "resume template or embedded fallback available",
  true,
  "Resume builder will use the default embedded template if external template is missing"
);

check(
  "@google/generative-ai installed",
  fs.existsSync("./node_modules/@google/generative-ai"),
  "Run npm install"
);

let chromiumReady = false;
try {
  const { chromium } = await import("playwright");
  const execPath = chromium.executablePath();
  chromiumReady = Boolean(execPath && fs.existsSync(execPath));
} catch {}

check(
  "Playwright Chromium browser installed",
  chromiumReady,
  "Run `npx playwright install chromium` or `npm run install:browsers`"
);

console.log("\n" + (allGood ? "🎉 All prerequisites satisfied! Get started by running: node evaluate.mjs\n" : "⚠️  Please address the issues flagged above.\n"));

if (!allGood) {
  console.log("📋 Quick Setup Solution:");
  console.log("   👉 Run: npm run setup (interactive wizard to configure profile, keys, and resume)\n");
}
