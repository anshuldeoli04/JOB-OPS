import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { REPO_ROOT } from "../config-utils.mjs";

test("Code Health: All tracked files contain zero Hinglish words and phrases", (t) => {
  let trackedFiles = [];
  try {
    const raw = execSync("git ls-files --cached --others --exclude-standard", { cwd: REPO_ROOT, encoding: "utf8" });
    trackedFiles = raw.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
  } catch {
    t.skip("git ls-files unavailable (non-git environment, e.g. ZIP archive); skipping tracked-scope Hinglish audit.");
    return;
  }

  // Filter to source, scripts, html, and documentation
  const candidates = trackedFiles.filter((relPath) => {
    if (relPath.startsWith("test/") || relPath.startsWith("tests/")) return false; // Exclude test files which define assertions
    if (relPath.startsWith("node_modules/")) return false;
    if (relPath.startsWith("frontend/")) return false;
    const ext = path.extname(relPath).toLowerCase();
    return [".mjs", ".js", ".jsx", ".html", ".md", ".json", ".bat", ".sh"].includes(ext);
  });

  assert.ok(candidates.length >= 10, `Expected at least 10 tracked files to scan, found ${candidates.length}`);

  const BROAD_HINGLISH_WORDS = [
    "karo", "karein", "karna", "karte", "krna", "krte",
    "hai", "hain", "nahi", "pehle", "chahiye", "rahe",
    "wala", "wali", "wale", "aur", "bhi", "hoga", "hogi",
    "honge", "dikhe", "dikhenge", "sirf", "apna", "apne",
    "apni", "kuch", "khatam", "thoda", "poora", "poori",
    "daalo", "naye", "likho", "dabao", "bohot", "bahut",
    "kaise", "kisko", "konsi", "chhoti", "seedha",
    "dobara", "samjho", "hatao", "banao", "shuru", "chalao",
    "dekho", "rakho", "karenge",
    "jaata", "jaati", "jaate", "aayega", "aayegi",
    "warna", "kyun", "kya", "batao",
  ];

  const FORBIDDEN_PHRASES = [
    /\bapna poora naam\b/i,
    /\blikho jab khatam\b/i,
    /\bthoda wait\b/i,
    /\bpehle new gemini\b/i,
    /\bverify ho raha hai\b/i,
    /\bsave karne ke liye ready\b/i,
    /\bvalidation fail ho gayi\b/i,
    /\byahan dikhenge\b/i,
    /\bhota hai\b/i,
    /\bhoti hai\b/i,
    /\bhote hain\b/i,
    /\bkaise kare\b/i,
  ];

  for (const relPath of candidates) {
    const fullPath = path.resolve(REPO_ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf8");

    // 1. Check broad individual Hinglish word list
    for (const word of BROAD_HINGLISH_WORDS) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      const match = content.match(re);
      assert.strictEqual(
        match,
        null,
        `Forbidden Hinglish word "${word}" found in tracked file ${relPath}: "${match?.[0]}"`
      );
    }

    // 2. Check compound phrases
    for (const pattern of FORBIDDEN_PHRASES) {
      const match = content.match(pattern);
      assert.strictEqual(
        match,
        null,
        `Forbidden Hinglish pattern ${pattern} found in tracked file ${relPath}: "${match?.[0]}"`
      );
    }
  }
});
