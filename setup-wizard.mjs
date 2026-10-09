/**
 * JOB-OPS Setup Wizard
 * Interactive CLI Onboarding & Configuration Wizard (Phase 1)
 *
 * Usage:
 *   node setup-wizard.mjs
 *   node setup-wizard.mjs --check
 *   node setup-wizard.mjs --non-interactive
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  CV_FILE,
  isPlaceholderCv,
  loadConfig,
  loadJsonFile,
  writeJsonFileAtomic,
  saveEnvUpdates,
  REPO_ROOT,
} from "./config-utils.mjs";
import { normalizeGeminiError } from "./llm/providers/gemini.mjs";

export { saveEnvUpdates } from "./config-utils.mjs";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const ENV_FILE = path.resolve(REPO_ROOT, ".env");
const CONFIG_LOCAL_FILE = path.resolve(REPO_ROOT, "config.local.json");
const CONFIG_FILE = path.resolve(REPO_ROOT, "config.json");

function maskSecret(val) {
  if (!val) return "";
  const s = String(val).trim();
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}••••••${s.slice(-4)}`;
}

export function parseEnvFile(filePath = ENV_FILE) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    env[k] = v;
  }
  return env;
}

export async function verifyGeminiKeyLive(apiKey, modelName = DEFAULT_GEMINI_MODEL) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("API key is required.");
  }
  const cleanKey = apiKey.trim();
  if (cleanKey.length < 15) {
    throw new Error("Key is too short to be a valid Gemini API key.");
  }

  const genAI = new GoogleGenerativeAI(cleanKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  try {
    const result = await model.generateContent("Reply with only: OK");
    const response = result.response.text();
    if (!response) {
      throw new Error("No response received from Gemini.");
    }
    return true;
  } catch (rawError) {
    const err = normalizeGeminiError(rawError);
    if (err.kind === "auth") {
      throw new Error(`Authentication failed: ${rawError.message}`);
    }
    if (err.kind === "quota_day" || err.kind === "rate_minute") {
      console.log("\n⚠️ Rate limit reached, key not rejected. Continuing.");
      return true;
    }
    throw rawError;
  }
}

export async function verifyGroqKeyLive(apiKey) {
  if (!apiKey) return false;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function extractCvFromPdf(pdfPath) {
  const fullPath = path.resolve(process.cwd(), pdfPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  let mod;
  try {
    mod = await import("pdf-parse");
  } catch {
    throw new Error("pdf-parse library not installed. Please run `npm install` first, or create cv.md directly.");
  }

  const buffer = fs.readFileSync(fullPath);
  const PDFParseClass = mod.PDFParse || mod.default?.PDFParse || (typeof mod.default === "function" ? mod.default : null);

  if (typeof PDFParseClass === "function" && PDFParseClass.prototype?.getText) {
    const parser = new PDFParseClass({ data: buffer });
    try {
      const data = await parser.getText();
      return (data?.text || "").trim();
    } finally {
      await parser.destroy?.();
    }
  } else if (typeof PDFParseClass === "function") {
    const data = await PDFParseClass(buffer);
    return (data?.text || "").trim();
  }

  throw new Error("Could not initialize parser from pdf-parse module.");
}

export function generateStarterCv(name, targetRoles = []) {
  const roleTitle = targetRoles[0] || "Software Engineer";
  return `# ${name}
**${roleTitle}**
Email: [[YOUR EMAIL]] | Phone: [[YOUR PHONE]] | Location: [[YOUR CITY]]

## Professional Summary
[[2-3 SENTENCES ABOUT YOUR REAL BACKGROUND AND EXPERTISE]]

## Technical Skills
- **Languages:** [[ONLY SKILLS YOU CAN DEFEND IN AN INTERVIEW]]
- **Frameworks & Libraries:** [[FRAMEWORKS AND LIBRARIES YOU USE]]
- **Tools & Databases:** [[DATABASES, CLOUD PLATFORMS, AND DEVELOPER TOOLS]]

## Projects
### [[PROJECT 1 NAME]]
- [[WHAT YOU ACTUALLY BUILT AND THE MEASURABLE OUTCOME]]
- [[KEY TECHNOLOGIES AND ARCHITECTURE]]

### [[PROJECT 2 NAME]]
- [[WHAT YOU ACTUALLY BUILT AND THE MEASURABLE OUTCOME]]
- [[KEY TECHNOLOGIES AND ARCHITECTURE]]

## Education
[[DEGREE, INSTITUTION, GRADUATION YEAR]]
`;
}

export async function runSetupWizard({ interactive = true, checkOnly = false } = {}) {
  console.log("\n============================================================");
  console.log("          JOB-OPS Guided Setup & Configuration Wizard       ");
  console.log("============================================================\n");

  const existingEnv = parseEnvFile();
  let existingConfig = {};
  try {
    existingConfig = loadConfig({ requireApiKey: false }) || {};
  } catch {}

  if (checkOnly) {
    console.log("🔍 Checking existing configuration...\n");
    const hasGemini = Boolean(existingEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY);
    const hasGroq = Boolean(existingEnv.GROQ_API_KEY || process.env.GROQ_API_KEY);
    const hasCv = fs.existsSync(CV_FILE) && !isPlaceholderCv(fs.readFileSync(CV_FILE, "utf8"));
    console.log(`  ${hasGemini ? "✅" : "❌"} Gemini API Key : ${hasGemini ? maskSecret(existingEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY) : "Missing"}`);
    console.log(`  ${hasGroq ? "✅" : "⚪"} Groq API Key   : ${hasGroq ? maskSecret(existingEnv.GROQ_API_KEY || process.env.GROQ_API_KEY) : "Not set (optional)"}`);
    console.log(`  ${hasCv ? "✅" : "❌"} Resume (cv.md) : ${hasCv ? "Ready" : "Missing / Placeholder"}`);
    console.log(`  ${existingConfig.name ? "✅" : "⚪"} Profile Name   : ${existingConfig.name || "Default"}`);
    return { hasGemini, hasGroq, hasCv };
  }

  if (!interactive) {
    console.log("Non-interactive mode: Validating and creating default configurations...");
    saveEnvUpdates({
      GEMINI_MODEL: existingEnv.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    });
    return { ok: true };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // 1. Profile Information
    console.log("📋 Step 1 of 4: Your Profile Information");
    console.log("------------------------------------------------------------");

    const defaultName = existingConfig.name || "Candidate Name";
    const nameAns = await rl.question(`Full Name [${defaultName}]: `);
    const name = nameAns.trim() || defaultName;

    const defaultRoles = (existingConfig.target_roles || [
      "Software Engineer",
      "Backend Developer",
      "Full Stack Developer",
    ]).join(", ");
    const rolesAns = await rl.question(`Target Roles (comma-separated) [${defaultRoles}]: `);
    const targetRoles = (rolesAns.trim() || defaultRoles)
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const defaultLocations = (existingConfig.target_locations || [
      "Bangalore",
      "Pune",
      "Hyderabad",
      "Remote India",
    ]).join(", ");
    const locAns = await rl.question(`Target Locations (comma-separated) [${defaultLocations}]: `);
    const targetLocations = (locAns.trim() || defaultLocations)
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);

    const defaultExpLevel = existingConfig.experience_level || "fresher";
    console.log("\nExperience Levels: 1) Fresher (0-1 yr)  2) Junior (1-3 yrs)  3) Mid (3-5 yrs)  4) Senior (5+ yrs)");
    const expChoice = await rl.question(`Select experience level (1-4) [default: 1]: `);
    const expMap = { "1": "fresher", "2": "junior", "3": "mid", "4": "senior" };
    const experienceLevel = expMap[expChoice.trim()] || defaultExpLevel;
    const experienceYears = experienceLevel === "fresher" ? 0 : experienceLevel === "junior" ? 2 : experienceLevel === "mid" ? 4 : 6;

    const defaultCtc = existingConfig.expected_ctc_lpa || "4-8";
    const ctcAns = await rl.question(`Expected CTC in LPA (e.g. 4-8, 10-18) [${defaultCtc}]: `);
    const expectedCtcLpa = ctcAns.trim() || defaultCtc;

    // 2. API Keys & Pre-flight Testing
    console.log("\n🔑 Step 2 of 4: AI Provider Credentials");
    console.log("------------------------------------------------------------");
    console.log("Gemini API key is required for AI job scoring and resume tailoring.");
    console.log("Get a free key from: https://aistudio.google.com/apikey\n");

    let currentGeminiKey = existingEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
    let geminiVerified = false;

    while (!geminiVerified) {
      const promptText = currentGeminiKey
        ? `Gemini API Key [currently: ${maskSecret(currentGeminiKey)}, press Enter to keep]: `
        : `Enter Gemini API Key: `;
      const keyInput = (await rl.question(promptText)).trim();
      const testKey = keyInput || currentGeminiKey;

      if (!testKey) {
        console.log("❌ Gemini API Key cannot be empty. Please enter your key.");
        continue;
      }

      process.stdout.write("⏳ Verifying key with live ping to Google Gemini API... ");
      try {
        await verifyGeminiKeyLive(testKey);
        console.log("✅ Verified successfully!\n");
        currentGeminiKey = testKey;
        geminiVerified = true;
      } catch (err) {
        console.log(`❌ Verification failed: ${err.message}`);
        const retryAns = await rl.question("Do you want to re-enter your key? (Y/n): ");
        if (retryAns.trim().toLowerCase() === "n") {
          currentGeminiKey = testKey;
          console.log("⚠️ Key saved without live verification.\n");
          geminiVerified = true;
        }
      }
    }

    // Optional Groq API Key
    console.log("Optional: Groq API Key for fast fallback when Gemini free quota is exhausted.");
    console.log("Get a free key from: https://console.groq.com/keys\n");
    let currentGroqKey = existingEnv.GROQ_API_KEY || process.env.GROQ_API_KEY || "";
    const groqPrompt = currentGroqKey
      ? `Groq API Key [currently: ${maskSecret(currentGroqKey)}, press Enter to keep, or 'none']: `
      : `Enter Groq API Key (press Enter to skip): `;
    const groqInput = (await rl.question(groqPrompt)).trim();
    if (groqInput.toLowerCase() === "none") {
      currentGroqKey = "";
    } else if (groqInput) {
      process.stdout.write("⏳ Verifying Groq key... ");
      const isOk = await verifyGroqKeyLive(groqInput);
      if (isOk) {
        console.log("✅ Verified successfully!\n");
        currentGroqKey = groqInput;
      } else {
        console.log("⚠️ Groq ping returned non-200. Key saved anyway.\n");
        currentGroqKey = groqInput;
      }
    }

    // 3. Resume (cv.md) Setup
    console.log("📄 Step 3 of 4: Resume & CV Setup");
    console.log("------------------------------------------------------------");
    const cvExists = fs.existsSync(CV_FILE);
    const cvIsReal = cvExists && !isPlaceholderCv(fs.readFileSync(CV_FILE, "utf8"));

    if (cvIsReal) {
      console.log("✅ Valid cv.md already found. Keeping current resume.");
    } else {
      console.log("cv.md is missing or contains placeholder markers.");
      console.log("Choose resume setup option:");
      console.log("  [1] Generate starter cv.md template (fill your experience manually)");
      console.log("  [2] Import text from an existing PDF resume");
      console.log("  [3] Skip for now (I will write cv.md myself)");

      const cvChoice = (await rl.question("Choice (1-3) [default: 3]: ")).trim() || "3";

      if (cvChoice === "1") {
        const starterContent = generateStarterCv(name, targetRoles);
        if (cvExists) {
          const overwriteConfirm = (
            await rl.question(`cv.md already exists. Overwrite with starter template? (y/N) [default: N]: `)
          ).trim().toLowerCase();
          if (overwriteConfirm !== "y" && overwriteConfirm !== "yes") {
            const starterPath = path.resolve(REPO_ROOT, "cv.starter.md");
            fs.writeFileSync(starterPath, starterContent, "utf8");
            console.log(`Kept existing cv.md. Saved starter template to ${starterPath} instead.`);
          } else {
            const backupPath = path.resolve(REPO_ROOT, `cv.backup.${Date.now()}.md`);
            fs.copyFileSync(CV_FILE, backupPath);
            fs.writeFileSync(CV_FILE, starterContent, "utf8");
            console.log(`Backed up existing cv.md to ${backupPath}. Created starter ${CV_FILE} with prompts.`);
          }
        } else {
          fs.writeFileSync(CV_FILE, starterContent, "utf8");
          console.log(`✅ Created starter ${CV_FILE} with prompts. Remember to replace [[...]] markers before evaluating jobs.`);
        }
      } else if (cvChoice === "2") {
        const pdfPath = (await rl.question("Path to your PDF resume: ")).trim();
        try {
          const text = await extractCvFromPdf(pdfPath);
          if (!text || text.trim().length < 50) {
            throw new Error("Extracted text is empty or too short.");
          }
          const draftPath = path.resolve(REPO_ROOT, "cv.draft.md");
          fs.writeFileSync(draftPath, text, "utf8");
          console.log(`\n📄 Extracted text written to ${draftPath} for review.`);
          console.log("Preview (first 400 chars):");
          console.log("------------------------------------------------------------");
          console.log(text.slice(0, 400));
          console.log("------------------------------------------------------------");
          const confirm = (await rl.question("Replace cv.md with this extracted text? (y/N): ")).trim().toLowerCase();
          if (confirm === "y" || confirm === "yes") {
            if (cvExists) {
              const backupPath = path.resolve(REPO_ROOT, `cv.backup.${Date.now()}.md`);
              fs.copyFileSync(CV_FILE, backupPath);
              console.log(`Backed up existing cv.md to ${backupPath}.`);
            }
            fs.writeFileSync(CV_FILE, text, "utf8");
            console.log(`✅ Saved extracted text to ${CV_FILE}.`);
          } else {
            console.log(`Kept ${draftPath}. You can review and copy it to ${CV_FILE} manually.`);
          }
        } catch (err) {
          console.log(`❌ PDF extraction failed: ${err.message}`);
          console.log("Please create cv.md manually.");
        }
      } else {
        console.log("Skipping cv.md generation. Remember to edit cv.md before running resume-builder.");
      }
    }

    // 4. Persistence & Summary
    console.log("\n💾 Step 4 of 4: Saving Configuration");
    console.log("------------------------------------------------------------");

    // Save secrets strictly to .env
    const envUpdates = {
      GEMINI_API_KEY: currentGeminiKey,
      GEMINI_MODEL: DEFAULT_GEMINI_MODEL,
    };
    if (currentGroqKey) {
      envUpdates.GROQ_API_KEY = currentGroqKey;
    }
    saveEnvUpdates(envUpdates);
    console.log("✅ Secrets safely persisted to .env");

    // Save non-secret config to config.local.json, merging into any existing keys
    const existingConfigLocal = loadJsonFile(CONFIG_LOCAL_FILE, { fallback: {} }) || {};
    const configData = {
      ...existingConfigLocal,
      name,
      gemini_model: DEFAULT_GEMINI_MODEL,
      groq_model: "llama-3.3-70b-versatile",
      target_roles: targetRoles,
      target_locations: targetLocations,
      experience_level: experienceLevel,
      experience_years: experienceYears,
      expected_ctc_lpa: expectedCtcLpa,
      allow_unrestricted_remote: true,
      disabled_sources: existingConfigLocal.disabled_sources || ["wellfound"],
    };
    writeJsonFileAtomic(CONFIG_LOCAL_FILE, configData);
    console.log("✅ User preferences saved to config.local.json");

    // Summary Card
    console.log("\n============================================================");
    console.log("               🎉 SETUP COMPLETED SUCCESSFULLY!             ");
    console.log("============================================================");
    console.log(`  Name             : ${name}`);
    console.log(`  Target Roles     : ${targetRoles.slice(0, 3).join(", ")}`);
    console.log(`  Experience       : ${experienceLevel} (${experienceYears} yrs)`);
    console.log(`  Gemini API       : ${maskSecret(currentGeminiKey)} (Active)`);
    if (currentGroqKey) {
      console.log(`  Groq API         : ${maskSecret(currentGroqKey)} (Configured)`);
    }
    console.log(`  Resume File      : ${fs.existsSync(CV_FILE) ? "cv.md (Ready)" : "Pending"}`);
    console.log("------------------------------------------------------------");
    console.log("🚀 Quick Start Commands:");
    console.log("   • Run end-to-end AutoFlow : npm run autoflow");
    console.log("   • Scan for jobs only      : npm run scanner");
    console.log("   • Evaluate a job manually : npm run evaluate");
    console.log("   • Build tailored resume   : npm run resume");
    console.log("============================================================\n");

    return { ok: true, name, targetRoles, targetLocations };
  } finally {
    rl.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const nonInteractive = args.includes("--non-interactive") || args.includes("--ci");
  runSetupWizard({ interactive: !nonInteractive, checkOnly }).catch((err) => {
    console.error(`\n❌ Setup Wizard failed: ${err.message}\n`);
    process.exit(1);
  });
}
