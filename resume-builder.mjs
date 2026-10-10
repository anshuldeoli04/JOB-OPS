/**
 * JOB-OPS Resume Builder
 * Intelligently rebuilds and tailors resumes for each job application
 * Usage: node resume-builder.mjs
 *        node resume-builder.mjs --job-id=<id>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { spawn } from "child_process";
import {
  APPLICATIONS_FILE,
  backupIfNeeded,
  loadApplications,
  loadConfig,
  loadCVWithCache,
  withFileLockSync,
  writeJsonFileAtomic,
} from "./config-utils.mjs";
import { callLLM } from "./llm/llmClient.mjs";
import { validateFactGrounding } from "./llm/factValidator.mjs";

const TEMPLATE_FILE = "./templates/resume-template.html";
const OUTPUT_DIR = "./output/resumes";
const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>{{NAME}} - Resume</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
    .header { border-bottom: 2px solid #cbd5e1; padding-bottom: 12px; margin-bottom: 18px; }
    .name { font-size: 28px; font-weight: 700; }
    .role { font-size: 14px; color: #475569; margin-top: 4px; }
    .contacts, .skills-wrap, .cert-wrap { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .ci, .tag, .cert { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
    .tag.hot { border-color: #2563eb; color: #1d4ed8; }
    .sec { margin-top: 18px; }
    .sec-title { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; color: #334155; }
    .entry { margin-bottom: 12px; }
    .entry-hdr, .edu-row { display: flex; justify-content: space-between; gap: 12px; }
    .entry-title, .edu-deg { font-weight: 700; }
    .entry-co, .entry-tech, .entry-meta, .edu-sch { color: #475569; font-size: 13px; }
    .bul { margin: 8px 0 0 18px; }
    .bul li { margin-bottom: 4px; }
    .summary, .kw-bar { font-size: 13px; line-height: 1.5; }
    .kw-bar { margin-top: 18px; padding: 10px 12px; background: #eff6ff; border: 1px solid #bfdbfe; }
  </style>
</head>
<body>
  <div class="header">
    <div class="name">{{NAME}}</div>
    <div class="role">{{TARGET_ROLE}}</div>
    <div class="contacts">{{CONTACTS_HTML}}</div>
  </div>
  {{SUMMARY_HTML}}
  {{SKILLS_HTML}}
  {{EXPERIENCE_HTML}}
  {{PROJECTS_HTML}}
  {{EDUCATION_HTML}}
  {{CERTS_HTML}}
  {{ACHIEVEMENTS_HTML}}
  {{KEYWORDS_BAR}}
</body>
</html>`;

function ensureOutputDirs() {
  fs.mkdirSync(path.join(OUTPUT_DIR, "html"), { recursive: true });
}

function safeOutputStem(value, fallback = "job") {
  return path.basename(String(value || fallback))
    .replace(/\.\.+/g, "-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || fallback;
}

function resolveInside(baseDir, ...parts) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Unsafe output path blocked: ${target}`);
  }
  return target;
}

async function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function getMultiline(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(prompt);
  console.log('(Type "DONE" on a new line when finished)');
  console.log("-".repeat(55));
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

function buildPrompt(cv, jobContext) {
  return `You are an expert ATS resume optimizer for the Indian tech job market (freshers/0-3yr experience).

TASK: Intelligently REBUILD this resume specifically for the target job.

STRICT RULES:
- NEVER fabricate skills, experience, or achievements not in the original CV
- DO rewrite bullet points to emphasize relevant aspects already present
- Preserve the original simple resume format and section order: Summary, Education, Projects, Experience, Skills, Soft Skills
- Do not add location, portfolio, certifications, achievements, links, company location, school year, or relocation text if it is not already in the original CV
- You may reorder projects only when the original CV already has a Projects section
- DO inject JD-specific keywords naturally into existing bullets
- DO write a targeted 2-sentence professional summary
- Mark hot_items = skills that directly match JD requirements
- Bullets format: Strong Action Verb + What + Impact/Result
- For freshers: Projects section is critical - make it shine

ORIGINAL CV:
${cv}

TARGET JOB:
${jobContext}

Respond ONLY with valid JSON (no markdown fences, no preamble):
{
  "name": "Full Name",
  "target_role": "Exact JD Role Title",
  "email": "email",
  "phone": "phone",
  "linkedin": "linkedin handle/url or null",
  "github": "github handle/url or null",
  "location": null,
  "portfolio": null,
  "summary": "2-sentence tailored summary. Mention 2-3 strongest relevant skills + what value you bring to THIS role.",
  "skills": [
    { "category": "Languages", "items": ["Python", "JS"], "hot_items": ["Python"] },
    { "category": "Frameworks", "items": ["FastAPI", "React"], "hot_items": ["FastAPI"] },
    { "category": "AI/ML Tools", "items": ["LangChain", "HuggingFace"], "hot_items": ["LangChain"] },
    { "category": "Databases", "items": ["PostgreSQL", "MongoDB"], "hot_items": [] },
    { "category": "DevOps/Cloud", "items": ["Docker", "Git", "AWS"], "hot_items": ["Docker"] }
  ],
  "experience": [
    {
      "title": "Intern / Role",
      "company": "Company",
      "duration": "Month Year - Month Year",
      "location": "City / Remote",
      "bullets": [
        "Rewritten bullet with relevant keywords naturally woven in",
        "Focus on impact, not just tasks"
      ]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "tech": "Python | FastAPI | PostgreSQL | Docker",
      "link": "github.com/user/repo or null",
      "bullets": [
        "Built X using Y, achieving Z - rewritten to emphasize JD-relevant aspects",
        "Second bullet focusing on a different relevant skill"
      ]
    }
  ],
  "education": [
    {
      "degree": "B.Tech Computer Science Engineering",
      "institution": "College Name, City",
      "year": "2024",
      "grade": "CGPA: 8.2/10"
    }
  ],
  "certifications": ["AWS Cloud Practitioner (2024)", "Google AI Essentials (2023)"],
  "achievements": ["Relevant achievement here"],
  "soft_skills": ["Problem-solving", "critical thinking", "adaptability"],
  "keywords_injected": ["keyword1", "keyword2", "keyword3"],
  "changes_made": [
    "Reordered projects: ML project moved to top",
    "Rewrote 3 project bullets to emphasize API development",
    "Injected 8 JD-specific keywords into existing bullets"
  ]
}`;
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineText(value = "") {
  return escapeHTML(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function joinParts(parts, separator = " | ") {
  return parts.filter((part) => part && String(part).trim()).map(inlineText).join(separator);
}

function renderHTML(d, template) {
  const contacts = [
    joinParts([d.email ? `Email: ${d.email}` : "", d.phone ? `Phone: ${d.phone}` : ""]),
    d.linkedin ? `LinkedIn: ${inlineText(d.linkedin)}` : "",
    d.github ? `GitHub: ${inlineText(d.github)}` : "",
  ].filter(Boolean).join("<br>");

  const summaryHTML = d.summary
    ? `<div class="sec"><div class="sec-title">Summary</div><div class="summary">${inlineText(d.summary)}</div></div>`
    : "";

  const eduInner = (d.education || []).map((e) => {
    const line1 = joinParts([e.degree, e.institution], ", ");
    const line2 = joinParts([e.year, e.grade]);
    return `<div class="entry"><div class="entry-title">${line1}</div>${line2 ? `<div class="edu-grade">${line2}</div>` : ""}</div>`;
  }).join("");
  const educationHTML = eduInner
    ? `<div class="sec"><div class="sec-title">Education</div>${eduInner}</div>`
    : "";

  const projInner = (d.projects || []).map((p) => `
    <div class="entry">
      <div class="entry-title">${inlineText(p.name || "")}</div>
      ${p.tech ? `<div class="entry-tech">Technologies: ${inlineText(p.tech)}</div>` : ""}
      <ul class="bul">${(p.bullets || []).map((b) => `<li>${inlineText(b)}</li>`).join("")}</ul>
    </div>`).join("");
  const projectsHTML = projInner
    ? `<div class="sec"><div class="sec-title">Projects</div>${projInner}</div>`
    : "";

  const expInner = (d.experience || []).map((e) => {
    const title = joinParts([e.title, e.company], ", ");
    const meta = e.duration ? ` | ${inlineText(e.duration)}` : "";
    return `
    <div class="entry">
      <div class="entry-title">${title}${meta}</div>
      <ul class="bul">${(e.bullets || []).map((b) => `<li>${inlineText(b)}</li>`).join("")}</ul>
    </div>`;
  }).join("");
  const experienceHTML = expInner
    ? `<div class="sec"><div class="sec-title">Experience</div>${expInner}</div>`
    : "";

  const skillItems = (d.skills || []).flatMap((sk) => sk.items || []);
  const skillsHTML = skillItems.length
    ? `<div class="sec"><div class="sec-title">Skills</div><div class="skills-line">${skillItems.map(inlineText).join(", ")}</div></div>`
    : "";

  const softSkillItems = d.soft_skills || [];
  const softSkillsHTML = softSkillItems.length
    ? `<div class="sec"><div class="sec-title">Soft Skills</div><div class="skills-line">${softSkillItems.map(inlineText).join(", ")}</div></div>`
    : "";

  const keywordItems = d.keywords_injected || [];
  const keywordsBarHTML = keywordItems.length
    ? `<div class="kw-bar"><strong>ATS Keywords:</strong> ${keywordItems.map(inlineText).join(" | ")}</div>`
    : "";

  const certsHTML = (d.certifications || []).length
    ? `<div class="sec"><div class="sec-title">Certifications</div><ul class="bul">${d.certifications.map((c) => `<li>${inlineText(c)}</li>`).join("")}</ul></div>`
    : "";

  const achievementsHTML = (d.achievements || []).length
    ? `<div class="sec"><div class="sec-title">Achievements</div><ul class="bul">${d.achievements.map((a) => `<li>${inlineText(a)}</li>`).join("")}</ul></div>`
    : "";

  return template
    .replaceAll("{{NAME}}", inlineText(d.name || ""))
    .replaceAll("{{TARGET_ROLE}}", inlineText(d.target_role || ""))
    .replaceAll("{{CONTACTS_HTML}}", contacts)
    .replaceAll("{{SUMMARY_HTML}}", summaryHTML)
    .replaceAll("{{EDUCATION_HTML}}", educationHTML)
    .replaceAll("{{PROJECTS_HTML}}", projectsHTML)
    .replaceAll("{{EXPERIENCE_HTML}}", experienceHTML)
    .replaceAll("{{SKILLS_HTML}}", skillsHTML)
    .replaceAll("{{SOFT_SKILLS_HTML}}", softSkillsHTML)
    .replaceAll("{{CERTS_HTML}}", certsHTML)
    .replaceAll("{{ACHIEVEMENTS_HTML}}", achievementsHTML)
    .replaceAll("{{KEYWORDS_BAR}}", keywordsBarHTML);
}
function generatePDF(htmlFile, pdfFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["./generate-pdf.mjs", htmlFile, pdfFile]);
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d;
    });
    proc.stderr.on("data", (d) => {
      out += d;
    });
    proc.on("close", (code) => {
      if (code === 0 && out.includes("SUCCESS")) {
        resolve(pdfFile);
      } else {
        reject(new Error(out.trim().slice(0, 200) || "PDF generation failed."));
      }
    });
    proc.on("error", (err) => {
      reject(new Error(`PDF generator error: ${err.message}`));
    });
  });
}

function extractLine(pattern, text) {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => pattern.test(line)) || "";
}

function buildFallbackResumeData(cv, jobContext) {
  const lines = cv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines.find((line) => !line.startsWith("#") && !line.includes("@") && line.length <= 80) || "Resume";
  const email = cv.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = cv.match(/(?:\+91[-\s]?)?[6-9]\d{9}/)?.[0] || "";
  const linkedin = extractLine(/linkedin\.com/i, cv).replace(/^[-*#\s]+/, "");
  const github = extractLine(/github\.com/i, cv).replace(/^[-*#\s]+/, "");
  const targetRole =
    jobContext.match(/Role:\s*(.+)/i)?.[1]?.trim() ||
    jobContext.split(/\r?\n/).find(Boolean)?.slice(0, 80) ||
    "Target Role";
  const skillWords = [
    "JavaScript", "TypeScript", "React", "Node.js", "Express", "Python", "Java", "SQL", "MySQL",
    "MongoDB", "AWS", "Docker", "Machine Learning", "AI", "REST", "Git", "HTML", "CSS"
  ].filter((skill) => new RegExp(skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(cv));
  const bullets = lines
    .filter((line) => /^[-*]/.test(line))
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .filter((line) => line.length > 12)
    .slice(0, 8);

  return {
    name,
    target_role: targetRole,
    email,
    phone,
    linkedin,
    github,
    location: "India",
    summary: `Candidate profile prepared for ${targetRole}. Gemini was unavailable, so this fallback resume preserves verified CV facts without fabricating experience.`,
    skills: skillWords.length ? [{ category: "Core", items: skillWords, hot_items: skillWords.slice(0, 5) }] : [],
    experience: [],
    projects: bullets.length ? [{ name: "Relevant CV Highlights", tech: "", bullets }] : [],
    education: [],
    certifications: [],
    achievements: [],
    changes_made: ["Gemini unavailable; generated conservative fallback from existing CV only."],
    keywords_injected: skillWords.slice(0, 8),
  };
}

function getResumeTemplate() {
  try {
    return fs.readFileSync(TEMPLATE_FILE, "utf8");
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

async function main() {
  console.clear();
  console.log("============================================================");
  console.log("                 JOB-OPS Resume Builder");
  console.log("   Tailored Resumes for Every Job via Routed AI — 100% Free");
  console.log("============================================================\n");

  let config;
  let cv;
  try {
    config = loadConfig();
    cv = loadCVWithCache();
    backupIfNeeded();
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    process.exit(1);
  }

  const template = getResumeTemplate();
  ensureOutputDirs();

  let jobContext = "";
  let jobLabel = "";

  const args = process.argv.slice(2);
  const jobIdArg = args.find((a) => a.startsWith("--job-id="))?.split("=")[1];

  if (jobIdArg) {
    const app = loadApplications().find((a) => a.id === jobIdArg);
    if (!app) {
      console.error(`[ERROR] Job ID ${jobIdArg} not found.`);
      process.exit(1);
    }
    jobContext = `Company: ${app.company}\nRole: ${app.role}\nLocation: ${app.location || "India"}\nGaps to address: ${(app.gaps || []).join(", ")}\nStrengths to highlight: ${(app.strengths || []).join(", ")}\nFit summary: ${app.fit_summary || ""}`;
    jobLabel = safeOutputStem(`${app.company}_${app.role}`);
  } else {
    const apps = loadApplications();
    console.log("Select target job for tailored resume:\n");
    console.log("  1. Select from evaluated jobs");
    console.log("  2. Paste new Job Description");
    const choice = await ask("\nChoice (1/2): ");

    if (choice === "1" && apps.length > 0) {
      const sorted = [...apps].sort((a, b) => (b.score || 0) - (a.score || 0));
      const icons = { A: "[A]", B: "[B]", C: "[C]", D: "[D]", F: "[F]" };
      sorted.forEach((a, i) =>
        console.log(`  ${String(i + 1).padEnd(3)} ${icons[a.grade] || "[ ]"} ${a.company.padEnd(20)} ${a.role.padEnd(30)} ${a.score}/10`)
      );
      const num = parseInt(await ask("\nNumber: "), 10) - 1;
      const sel = sorted[num];
      if (!sel) {
        console.error("[ERROR] Invalid.");
        process.exit(1);
      }
      jobContext = `Company: ${sel.company}\nRole: ${sel.role}\nLocation: ${sel.location || "India"}\nGaps: ${(sel.gaps || []).join(", ")}\nStrengths: ${(sel.strengths || []).join(", ")}\nFit summary: ${sel.fit_summary || ""}`;
      jobLabel = safeOutputStem(`${sel.company}_${sel.role}`);
    } else {
      jobContext = await getMultiline("\nPaste Job Description:");
      if (!jobContext || jobContext.length < 30) {
        console.error("[ERROR] Too short.");
        process.exit(1);
      }
      jobLabel = safeOutputStem(jobContext.split("\n")[0], "job").slice(0, 40) || "job";
    }
  }

  console.log("\nTailoring resume via routed LLM (Gemini primary, Groq fallback)... (15-25 seconds)\n");

  let resumeData;
  let usedFallback = false;
  try {
    const raw = await callLLM("tailor_resume", [{ role: "user", content: buildPrompt(cv, jobContext) }], {
      config,
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseFormat: { type: "json_object" },
      allowGroqFallback: true,
    });
    const rawText = raw?.text || String(raw);
    resumeData = JSON.parse(rawText.replace(/```json\n?|```\n?/g, "").trim());

    // Deterministic Fact-Grounding Verification (T9)
    const check = validateFactGrounding(resumeData, cv);
    if (!check.isValid) {
      console.warn(`[WARN] Fact validation detected ${check.violations.length} ungrounded item(s):`);
      check.violations.slice(0, 3).forEach((v) => console.warn(`   - ${v}`));
      console.log("Retrying tailoring once with strict grounding constraints...");
      try {
        const retryPrompt = `${buildPrompt(cv, jobContext)}\n\nIMPORTANT: Your previous output had ungrounded claims:\n${check.violations.map((v) => `- ${v}`).join("\n")}\nStrictly fix these and include ONLY facts, skills, numbers, and companies directly found in the ORIGINAL CV.`;
        const retryRaw = await callLLM("tailor_resume", [{ role: "user", content: retryPrompt }], {
          config,
          temperature: 0.0,
          maxOutputTokens: 8192,
          responseFormat: { type: "json_object" },
          allowGroqFallback: true,
        });
        const retryText = retryRaw?.text || String(retryRaw);
        const retryData = JSON.parse(retryText.replace(/```json\n?|```\n?/g, "").trim());
        const retryCheck = validateFactGrounding(retryData, cv);
        if (retryCheck.isValid) {
          console.log("[OK] Retry successfully satisfied fact-grounding checks.");
          resumeData = retryData;
        } else {
          console.warn("[WARN] Retry also contained ungrounded items. Falling back to base untailored resume.");
          resumeData = buildFallbackResumeData(cv, jobContext);
          usedFallback = true;
        }
      } catch (retryErr) {
        console.warn("[WARN] Retry failed. Falling back to base untailored resume.");
        resumeData = buildFallbackResumeData(cv, jobContext);
        usedFallback = true;
      }
    }
  } catch (error) {
    usedFallback = true;
    console.error("[WARN] Gemini unavailable or parse failed. Generating conservative fallback resume.\n", error.message.slice(0, 120));
    resumeData = buildFallbackResumeData(cv, jobContext);
  }

  const ts = Date.now();
  const safeName = safeOutputStem(resumeData.name || "Resume", "Resume");
  const htmlFile = resolveInside(OUTPUT_DIR, "html", `${safeName}_${jobLabel}_${ts}.html`);
  const pdfFile = resolveInside(OUTPUT_DIR, `${safeName}_${jobLabel}_${ts}.pdf`);
  let finalPdfFile = pdfFile;

  fs.writeFileSync(htmlFile, renderHTML(resumeData, template));
  console.log(`[OK] HTML: ${htmlFile}`);

  console.log("Generating PDF...");
  try {
    await generatePDF(htmlFile, pdfFile);
    console.log(`[OK] PDF: ${pdfFile}`);
  } catch (error) {
    finalPdfFile = null;
    console.log("[WARN] PDF generation failed - please open the HTML in a browser -> Print -> Save as PDF");
    console.log(`   HTML: ${htmlFile}`);
    console.log(`   Error: ${error.message}`);
  }

  console.log("\n" + "-".repeat(55));
  console.log("CHANGES MADE:");
  (resumeData.changes_made || []).forEach((change) => console.log(`   - ${change}`));
  if (usedFallback) {
    console.log("   - Fallback mode: review output manually before applying.");
  }
  if (resumeData.keywords_injected?.length) {
    console.log(`\nKEYWORDS INJECTED: ${resumeData.keywords_injected.join(" | ")}`);
  }
  console.log("-".repeat(55));

  if (jobIdArg) {
    withFileLockSync(APPLICATIONS_FILE, () => {
      const apps = loadApplications();
      const idx = apps.findIndex((a) => a.id === jobIdArg);
      if (idx >= 0) {
        apps[idx].resume_pdf = finalPdfFile;
        apps[idx].resume_html = htmlFile;
        writeJsonFileAtomic(APPLICATIONS_FILE, apps, { lock: false });
      }
    });
    console.log("Linked in application tracker.\n");
  }

  console.log(`\nOUTPUT:\n   PDF  -> ${finalPdfFile || "Not generated"}\n   HTML -> ${htmlFile}\n`);
}

export { main };

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch(console.error);
}

