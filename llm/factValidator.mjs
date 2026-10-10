/**
 * JOB-OPS Fact Validator
 * Deterministic grounding verification for tailored resume outputs.
 * Ensures generated skills, employers, institutions, and metrics strictly
 * originate from the candidate's original CV.
 */

export const TECH_SYNONYMS = [
  ["js", "javascript"],
  ["ts", "typescript"],
  ["py", "python"],
  ["postgres", "postgresql"],
  ["mongo", "mongodb"],
  ["react", "react.js", "reactjs"],
  ["node", "node.js", "nodejs"],
  ["express", "express.js", "expressjs"],
  ["next", "next.js", "nextjs"],
  ["vue", "vue.js", "vuejs"],
  ["tailwind", "tailwindcss"],
  ["aws", "amazon web services"],
  ["gcp", "google cloud", "google cloud platform"],
  ["k8s", "kubernetes"],
  ["docker", "containerization", "containers"],
  ["ci/cd", "cicd", "continuous integration"],
  ["rest", "restful", "rest api", "restful api"],
  ["ml", "machine learning"],
  ["ai", "artificial intelligence"],
  ["c++", "cpp"],
  ["golang", "go"],
  ["html", "html5"],
  ["css", "css3"],
  ["git", "github"],
  ["sql", "relational databases", "rdbms"],
];

function normalizeStr(str = "") {
  return String(str).toLowerCase().trim();
}

export function extractGroundTruth(cvText = "") {
  const text = String(cvText);
  const textLower = text.toLowerCase();

  // Extract all numbers (integers, decimals, percentages, years)
  const numberMatches = text.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  const numbers = new Set(numberMatches);

  // Extract all word tokens (alphanumeric, length >= 2)
  const tokenMatches = textLower.match(/[a-z0-9#+.]+/g) || [];
  const tokens = new Set(tokenMatches);

  return { textLower, numbers, tokens };
}

function areSynonyms(a, b) {
  const normA = normalizeStr(a);
  const normB = normalizeStr(b);
  if (normA === normB) return true;

  for (const group of TECH_SYNONYMS) {
    const hasA = group.some((s) => s === normA || normA.includes(s));
    const hasB = group.some((s) => s === normB || normB.includes(s));
    if (hasA && hasB) return true;
  }
  return false;
}

export function isSkillGrounded(skill, cvTextLower, groundTruth) {
  const clean = normalizeStr(skill);
  if (!clean) return true;

  // Direct substring match in CV
  if (cvTextLower.includes(clean)) return true;

  // Word-token match in CV
  const words = clean.split(/[\s,/]+/).filter(Boolean);
  if (words.length > 0 && words.every((w) => groundTruth.tokens.has(w))) {
    return true;
  }

  // Synonym match
  for (const group of TECH_SYNONYMS) {
    if (group.some((s) => s === clean || clean.includes(s))) {
      // Check if any counterpart in this synonym group exists in CV
      if (group.some((s) => cvTextLower.includes(s) || groundTruth.tokens.has(s))) {
        return true;
      }
    }
  }

  return false;
}

export function isEntityGrounded(entity, cvTextLower, groundTruth) {
  const clean = normalizeStr(entity);
  if (!clean) return true;

  if (cvTextLower.includes(clean)) return true;

  // Check if all significant words appear in tokens
  const words = clean.split(/\s+/).filter((w) => w.length > 2);
  if (words.length > 0 && words.every((w) => groundTruth.tokens.has(w))) {
    return true;
  }

  return false;
}

export function validateFactGrounding(resumeData = {}, cvText = "") {
  const violations = [];
  if (!cvText || typeof cvText !== "string") {
    return { isValid: true, violations: [] };
  }

  const groundTruth = extractGroundTruth(cvText);
  const cvTextLower = groundTruth.textLower;

  // 1. Validate Skills
  if (Array.isArray(resumeData.skills)) {
    for (const group of resumeData.skills) {
      const items = Array.isArray(group.items) ? group.items : [];
      for (const skill of items) {
        if (!isSkillGrounded(skill, cvTextLower, groundTruth)) {
          violations.push(`Invented skill: "${skill}"`);
        }
      }
    }
  }

  // 2. Validate Employers in Experience
  if (Array.isArray(resumeData.experience)) {
    for (const exp of resumeData.experience) {
      if (exp.company && !isEntityGrounded(exp.company, cvTextLower, groundTruth)) {
        violations.push(`Invented employer: "${exp.company}"`);
      }
    }
  }

  // 3. Validate Institutions in Education
  if (Array.isArray(resumeData.education)) {
    for (const edu of resumeData.education) {
      if (edu.institution && !isEntityGrounded(edu.institution, cvTextLower, groundTruth)) {
        violations.push(`Invented institution: "${edu.institution}"`);
      }
    }
  }

  // 4. Validate Numbers & Metrics in Summary and Bullet Points
  const bulletTexts = [];
  if (resumeData.summary) bulletTexts.push(resumeData.summary);

  if (Array.isArray(resumeData.experience)) {
    for (const exp of resumeData.experience) {
      if (Array.isArray(exp.bullets)) {
        bulletTexts.push(...exp.bullets);
      }
    }
  }

  if (Array.isArray(resumeData.projects)) {
    for (const proj of resumeData.projects) {
      if (Array.isArray(proj.bullets)) {
        bulletTexts.push(...proj.bullets);
      }
    }
  }

  // Allowed small ordinal formatting numbers
  const standardAllowed = new Set(["1", "2", "3"]);

  for (const text of bulletTexts) {
    const numbersInText = text.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
    for (const num of numbersInText) {
      if (!standardAllowed.has(num) && !groundTruth.numbers.has(num)) {
        // Strip percentage sign and check raw number as well
        const rawNum = num.replace("%", "");
        if (!groundTruth.numbers.has(rawNum)) {
          violations.push(`Invented or modified number/metric: "${num}" in "${text.slice(0, 60)}..."`);
        }
      }
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}
