export function getExperienceProfile(config = {}, overrides = {}) {
  const rawYears = overrides.experience_years ?? config.experience_years;
  const parsedYears = Number(rawYears);
  const experienceYears = Number.isFinite(parsedYears)
    ? Math.max(0, parsedYears)
    : inferYearsFromLevel(config.experience_level);
  const level = normalizeExperienceLevel(config.experience_level, experienceYears);
  return {
    years: experienceYears,
    level,
    label: `${experienceYears} year${experienceYears === 1 ? "" : "s"} (${level})`,
  };
}

function inferYearsFromLevel(level) {
  const normalized = String(level || "").trim().toLowerCase();
  if (!normalized || normalized === "fresher" || normalized === "entry-level") return 0;
  const firstNumber = normalized.match(/\d+/)?.[0];
  if (firstNumber) return Math.max(0, Number(firstNumber));
  return 0;
}

function normalizeExperienceLevel(level, years) {
  const normalized = String(level || "").trim().toLowerCase();
  if (normalized) return normalized;
  if (years <= 0) return "fresher";
  if (years < 2) return "junior";
  if (years < 5) return "mid-level";
  return "experienced";
}

export function extractRelevantExperienceText(text) {
  if (!text || typeof text !== "string") return "";
  const normalized = text.replace(/[–—−]/g, "-");
  const sentences = normalized.split(/[.\n;•·|\r]/);
  const relevant = [];

  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (
      /\b(experience|exp|work\s+exp|relevant\s+exp|yr(s)?\s+(?:of\s+)?exp)\b/i.test(trimmed) ||
      /\b(freshers?(?:\s+welcome)?|no\s+experience|entry[\s-]?level|intern|trainee)\b/i.test(trimmed) ||
      /\b\d+\s*(?:-|to)\s*\d+\s*(?:\+)?\s*(?:years|year|yrs|yr)\b/i.test(trimmed) ||
      /\b\d+\s*\+\s*(?:years|year|yrs|yr)\b/i.test(trimmed)
    ) {
      if (/\b(?:years|yrs)\s+of\s+(?:history|excellence|existence|standing|legacy|service|trust)\b/i.test(trimmed)) {
        continue;
      }
      relevant.push(trimmed);
    }
  }

  return relevant.join(" ");
}

export function extractUrlSlugText(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = url.includes("://") ? new URL(url) : null;
    const pathStr = parsed ? parsed.pathname : url;
    const cleanPath = pathStr.replace(/\.[a-z0-9]+$/i, "");
    let slug = decodeURIComponent(cleanPath).replace(/[-_\\/]+/g, " ");
    slug = slug.replace(/\b\d+\s*(?:years|year|yrs|yr)\s+of\s+(?:trust|history|excellence|existence|standing|legacy|service)\b/gi, "");
    return slug;
  } catch {
    return String(url).replace(/[-_\\/]+/g, " ");
  }
}

export function extractMinYears(text) {
  if (!text) return null;
  let normalized = String(text).replace(/[–—−]/g, "-").toLowerCase();
  normalized = normalized.replace(/\b\d+\s*(?:years|year|yrs|yr)\s+of\s+(?:trust|history|excellence|existence|standing|legacy|service)\b/gi, "");

  const rangeMatch = normalized.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:\+)?\s*(?:years|year|yrs|yr)\b/);
  if (rangeMatch) return Number(rangeMatch[1]);

  const plusMatch = normalized.match(/(\d+)\s*\+\s*(?:years|year|yrs|yr)\b/);
  if (plusMatch) return Number(plusMatch[1]);

  const minMatch = normalized.match(/(?:minimum|min|at least|requires?|looking for)\s+(\d+)\s*(?:years|year|yrs|yr)\b/);
  if (minMatch) return Number(minMatch[1]);

  if (/\b(freshers?(?:\s+welcome)?|entry[\s-]?level|new grad|graduate program|no\s+experience(?:\s+required)?|0\s*years?)\b/.test(normalized)) {
    return 0;
  }

  return null;
}

export function buildExperienceContext(job = {}) {
  const jdText = [job.content, job.description, job.summary].filter(Boolean).join(" ");
  const relevantJdText = extractRelevantExperienceText(jdText);
  const urlSlugText = extractUrlSlugText(job.url);

  return [job.experience, job.role, job.title, relevantJdText, urlSlugText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function assessExperienceFit(job = {}, profile = { years: 0, level: "fresher" }, config = {}) {
  const context = buildExperienceContext(job);
  const title = String(job.role || job.title || "").toLowerCase();
  const years = Number(profile?.years || 0);
  const minYears = extractMinYears(context);

  const seniorTitlePatterns = [
    /\bsenior\b/i,
    /\b(sr\.?|snr)\b/i,
    /\bstaff\b/i,
    /\blead\b/i,
    /\bprincipal\b/i,
    /\barchitect\b/i,
    /\bmanager\b/i,
    /\bdirector\b/i,
    /\bhead\b/i,
    /\bvp\b/i,
    /\b(sde[- ]?(?:2|ii|3|iii)|swe[- ]?(?:2|ii|3|iii)|software engineer (?:2|ii|3|iii))\b/i,
    /\b(engineer|developer|sde|mts)\s+(?:2|ii|3|iii|iv)\b/i,
    /\blevel\s+(?:2|ii|3|iii)\b/i,
  ];

  const juniorTitlePatterns = [
    /\bintern(ship)?\b/i,
    /\btrainee\b/i,
    /\bassociate\b/i,
    /\bjunior\b/i,
    /\bentry[\s-]?level\b/i,
    /\bnew grad\b/i,
    /\bfresher\b/i,
    /\bgraduate\b/i,
  ];

  if (seniorTitlePatterns.some((pattern) => pattern.test(title))) {
    return { compatible: false, reason: "senior_title", minYears, experience_unknown: false };
  }

  const isFresher = years <= 0 || profile?.level === "fresher" || profile?.level === "entry-level";
  const fresherMaxMinYears = Number(config?.fresher_max_min_years ?? 0);

  if (minYears !== null) {
    if (isFresher) {
      if (minYears > fresherMaxMinYears) {
        return { compatible: false, reason: "experience_requirement", minYears, experience_unknown: false };
      }
    } else {
      if (minYears > years + 1) {
        return { compatible: false, reason: "experience_requirement", minYears, experience_unknown: false };
      }
    }
    return { compatible: true, reason: "compatible", minYears, experience_unknown: false };
  }

  if (juniorTitlePatterns.some((pattern) => pattern.test(title))) {
    return { compatible: true, reason: "junior_match", minYears: 0, experience_unknown: false };
  }

  return { compatible: true, reason: "compatible", minYears: null, experience_unknown: true };
}
