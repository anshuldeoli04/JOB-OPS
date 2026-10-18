import { sleep } from "../utils/fileLock.mjs";

export const DEFAULT_GRADE_THRESHOLDS = Object.freeze({ A: 8.0, B: 6.5, C: 5.0, D: 3.5 });

export function gradeFromScore(score, t = DEFAULT_GRADE_THRESHOLDS) {
  const num = Number(score);
  if (!Number.isFinite(num)) return "C";
  const thresholds = t || DEFAULT_GRADE_THRESHOLDS;
  if (num >= (thresholds.A ?? 8.0)) return "A";
  if (num >= (thresholds.B ?? 6.5)) return "B";
  if (num >= (thresholds.C ?? 5.0)) return "C";
  if (num >= (thresholds.D ?? 3.5)) return "D";
  return "F";
}

function normalizeScore(score) {
  const parsed = Number(score);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(10, Math.max(1, Math.round(parsed * 10) / 10));
}

export function validateEvaluation(raw = {}, context = {}) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const provider = safe.provider || context.provider || "gemini";
  const model = safe.model || context.model || "";
  const evaluated_by =
    safe.evaluated_by ||
    context.evaluated_by ||
    (provider ? `${provider}${model ? `/${model}` : ""}` : "gemini");

  let score = normalizeScore(safe.score ?? 5);
  let gaps = Array.isArray(safe.gaps) ? safe.gaps.filter(Boolean).map(String) : [];

  const hasDescription =
    context.hasDescription ??
    Boolean(context.content || safe.content || safe.description || context.jobDescription);

  if (hasDescription === false) {
    if (score > 6.5) {
      score = 6.5;
    }
    const missingJdGap = "No job description available";
    if (!gaps.some((g) => g.toLowerCase().includes("no job description available"))) {
      gaps = [missingJdGap, ...gaps];
    }
  }

  const grade = gradeFromScore(score, context.gradeThresholds || context.grade_thresholds);

  let verdict = String(safe.verdict || "");
  if (!verdict || verdict === "undefined") {
    if (grade === "A" || grade === "B") verdict = "Apply Now";
    else if (grade === "C") verdict = "Apply with Prep";
    else verdict = "Skip";
  } else if ((grade === "D" || grade === "F") && /apply/i.test(verdict)) {
    verdict = "Skip";
  }

  const defaults = {
    company: context.company || "Unknown",
    role: context.role || "Unknown",
    location: context.location || "Unknown",
    provider,
    model,
    evaluated_by,
    score,
    grade,
    verdict,
    strengths: [],
    gaps,
    interview_prep: [],
    action_items: [],
    cv_highlights: [],
    fit_summary: "Evaluation incomplete.",
    salary_estimate: "Not available",
    negotiation_note: "",
    action: "Review the job details manually before applying.",
  };

  return {
    ...defaults,
    ...safe,
    company: String(safe.company || defaults.company),
    role: String(safe.role || defaults.role),
    location: String(safe.location || defaults.location),
    provider: String(safe.provider || defaults.provider),
    model: String(safe.model || defaults.model),
    evaluated_by: String(safe.evaluated_by || defaults.evaluated_by),
    score,
    grade,
    verdict,
    strengths: Array.isArray(safe.strengths) ? safe.strengths.filter(Boolean) : defaults.strengths,
    gaps,
    interview_prep: Array.isArray(safe.interview_prep)
      ? safe.interview_prep.filter(Boolean)
      : defaults.interview_prep,
    action_items: Array.isArray(safe.action_items) ? safe.action_items.filter(Boolean) : defaults.action_items,
    cv_highlights: Array.isArray(safe.cv_highlights) ? safe.cv_highlights.filter(Boolean) : defaults.cv_highlights,
    fit_summary: String(safe.fit_summary || defaults.fit_summary),
    salary_estimate: String(safe.salary_estimate || defaults.salary_estimate),
    negotiation_note: String(safe.negotiation_note || defaults.negotiation_note),
    action: String(safe.action || defaults.action),
  };
}

export function isRetryableGeminiError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("temporarily unavailable") ||
    message.includes("503")
  );
}

export function getRetryAfterMs(error) {
  const explicit = Number(error?.retryAfterMs || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const message = String(error?.message || "");
  const retryDelayMatch = message.match(/retryDelay["']?\s*:\s*["']?(\d+)s/i);
  if (retryDelayMatch) return Number(retryDelayMatch[1]) * 1000;

  const retryAfterMatch = message.match(/retry(?:\s|-)?after[^0-9]*(\d+)/i);
  if (retryAfterMatch) return Number(retryAfterMatch[1]) * 1000;

  return 0;
}

export async function withRetry(operation, options = {}) {
  const {
    retries = 4,
    initialDelayMs = 2000,
    factor = 2,
    maxDelayMs = 90000,
    shouldRetry = isRetryableGeminiError,
    onRetry,
  } = options;

  let attempt = 0;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt < retries && shouldRetry(error);
      if (!canRetry) throw error;

      const retryAfterMs = getRetryAfterMs(error);
      const waitMs = Math.max(Math.min(delayMs, maxDelayMs), retryAfterMs);
      attempt += 1;
      if (onRetry) onRetry({ attempt, waitMs, error });
      await sleep(waitMs);
      delayMs *= factor;
    }
  }
}
