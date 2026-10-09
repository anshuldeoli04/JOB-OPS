import { callGemini } from "./providers/gemini.mjs";
import { callGroq } from "./providers/groq.mjs";
import { getGeminiUsageStats, readBreakerState, writeBreakerState } from "../config-utils.mjs";
import { logLLM } from "./logger.mjs";
import {
  isInteractiveSession,
} from "./keyManager.mjs";

export { logLLM };

export const TASK_ROUTING = {
  score_job: "gemini",
  tailor_resume: "gemini",
  score_report: "gemini",
  cover_letter: "groq",
  extract_skills: "groq",
  summarize_jd: "groq",
  interview_prep: "groq",
};

const INTER_CALL_DELAY_MS = 6500;

export class QuotaExhaustedError extends Error {
  constructor(message, earliestAvailableAt = null) {
    super(message);
    this.name = "QuotaExhaustedError";
    this.isQuotaExhausted = true;
    this.earliestAvailableAt = earliestAvailableAt;
  }
}

export const providerHealth = {
  gemini: { until: 0, why: "" },
  groq: { until: 0, why: "" },
};

export function getProviderHealth() {
  try {
    const persisted = readBreakerState();
    for (const p of ["gemini", "groq"]) {
      if (persisted[p] && typeof persisted[p].until === "number") {
        if (persisted[p].until > (providerHealth[p]?.until || 0)) {
          providerHealth[p] = { ...persisted[p] };
        }
      }
    }
  } catch {}
  return { ...providerHealth };
}

export function getNextPacificMidnight(baseDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(baseDate);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value.padStart(2, "0");
  const d = parts.find((p) => p.type === "day")?.value.padStart(2, "0");

  const calDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 1));
  const nextY = calDate.getUTCFullYear();
  const nextM = String(calDate.getUTCMonth() + 1).padStart(2, "0");
  const nextD = String(calDate.getUTCDate()).padStart(2, "0");
  const targetDateStr = `${nextY}-${nextM}-${nextD}`;

  for (const offset of ["-07:00", "-08:00"]) {
    const candidate = new Date(`${targetDateStr}T00:00:00${offset}`).getTime();
    const candidateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(new Date(candidate));
    const candHour = parseInt(candidateParts.find((p) => p.type === "hour")?.value || "0", 10) % 24;
    const candMin = parseInt(candidateParts.find((p) => p.type === "minute")?.value || "0", 10);
    const candDay = candidateParts.find((p) => p.type === "day")?.value.padStart(2, "0");
    if (candHour === 0 && candMin === 0 && candDay === nextD) {
      return candidate;
    }
  }

  return Date.now() + 24 * 3600 * 1000;
}

let geminiQueue = Promise.resolve();

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function getGeminiDailyLimit(options = {}) {
  const raw =
    options.geminiDailyRequestLimit ??
    options.config?.gemini_daily_request_limit ??
    process.env.GEMINI_DAILY_REQUEST_LIMIT;

  if (raw === undefined || raw === null || raw === "") {
    return null; // Unset: rely on API errors
  }
  const configured = Number(raw);
  if (!Number.isFinite(configured) || configured <= 0) return null;
  return configured;
}

export function checkGeminiDailyBudget(options = {}) {
  const dailyLimit = getGeminiDailyLimit(options);
  if (dailyLimit === null) {
    return { limitReached: false }; // Rely on real API errors
  }
  const usageStats = getGeminiUsageStats();
  // Count successes against the daily budget (provider 429s/failures do not consume daily quota)
  const usageCount = usageStats.success;
  if (usageCount >= dailyLimit) {
    const error = new Error(
      `Daily Gemini quota reached (${usageCount}/${dailyLimit} successful calls, ${usageStats.failed} failed). Resets at midnight Pacific Time.`
    );
    error.status = 429;
    error.code = "GEMINI_DAILY_LIMIT_REACHED";
    error.dailyLimitReached = true;
    error.kind = "quota_day";
    updateProviderHealth("gemini", {
      kind: "quota_day",
      status: 429,
      message: "Daily Gemini limit reached in configured local budget",
      resetUntil: getNextPacificMidnight(),
    });
    return { limitReached: true, error };
  }
  return { limitReached: false };
}

function classifyError(provider, error) {
  const kind = error.kind || "other";
  const status = error.status || 500;
  const retryAfterMs = error.retryAfterMs || 0;
  return {
    kind,
    status,
    retryAfterMs,
    quotaId: error.quotaId || "",
    resetUntil: error.resetUntil || null,
    message: error.message || "",
  };
}

export function updateProviderHealth(provider, info) {
  if (info.kind === "quota_day") {
    const resetTime =
      info.resetUntil ||
      (provider === "gemini" ? getNextPacificMidnight() : Date.now() + 60 * 60 * 1000);
    providerHealth[provider].until = resetTime;
    const resetIST = new Date(resetTime).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
    const resetDateIST = new Date(resetTime).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    providerHealth[provider].why = `Daily quota exhausted: ${info.message?.slice(0, 80) || ""}`;
    console.log(`[${provider}] quota_day status=${info.status || 429} exhausted until ${resetDateIST} ${resetIST} IST`);
    logLLM(`[Circuit Breaker] ${provider} marked EXHAUSTED until ${resetDateIST} ${resetIST} IST.`);
  } else if (info.kind === "rate_minute") {
    const wait = Math.min(info.retryAfterMs || 30000, 60000);
    providerHealth[provider].until = Date.now() + wait;
    const retrySec = Math.ceil(wait / 1000);
    providerHealth[provider].why = `Rate limit: waiting ${retrySec}s`;
    const quotaDetail = info.quotaId ? ` quotaId=${info.quotaId}` : "";
    console.log(`[${provider}] rate_minute status=429${quotaDetail} retry=${retrySec}s`);
    logLLM(`[Circuit Breaker] ${provider} rate_minute cooling down for ${retrySec}s.`);
  } else if (info.kind === "auth") {
    providerHealth[provider].until = Infinity;
    providerHealth[provider].why = "Authentication / API key error";
    console.log(`[${provider}] auth error: disabled`);
    logLLM(`[Circuit Breaker] ${provider} disabled (Auth error).`);
  } else {
    providerHealth[provider].until = Date.now() + 10000;
    providerHealth[provider].why = info.message?.slice(0, 80) || "";
  }

  try {
    const current = readBreakerState();
    current[provider] = {
      until: providerHealth[provider].until,
      why: providerHealth[provider].why,
    };
    writeBreakerState(current);
  } catch {}
}

async function executeGeminiWithPacing(messages, options = {}) {
  getProviderHealth();
  if (Date.now() < providerHealth.gemini.until) {
    const error = new Error(`Gemini cooling down: ${providerHealth.gemini.why}`);
    error.kind = "rate_minute";
    error.status = 429;
    throw error;
  }

  const budget = checkGeminiDailyBudget(options);
  if (budget.limitReached) {
    throw budget.error;
  }

  const delayMs = Math.max(
    INTER_CALL_DELAY_MS,
    Number(options.geminiDelayMs ?? process.env.GEMINI_REQUEST_DELAY_MS ?? INTER_CALL_DELAY_MS)
  );

  const task = geminiQueue.then(async () => {
    await sleep(delayMs);
    try {
      return await callGemini(messages, options);
    } catch (err) {
      if (err.kind === "rate_minute" && (err.retryAfterMs || 0) <= 60000) {
        const wait = Math.min(err.retryAfterMs || 5000, 60000);
        const retrySec = Math.ceil(wait / 1000);
        const quotaDetail = err.quotaId ? ` quotaId=${err.quotaId}` : "";
        console.log(`[gemini] rate_minute status=429${quotaDetail} retry=${retrySec}s`);
        logLLM(`[Gemini] Quick rate limit retry: waiting ${retrySec}s...`);
        await sleep(wait);
        return await callGemini(messages, options);
      }
      throw err;
    }
  });

  geminiQueue = task.catch(() => {});
  return task;
}

export async function callLLM(taskType, messages, options = {}) {
  getProviderHealth();
  const preferred = options.provider || TASK_ROUTING[taskType] || "gemini";
  // N-2: Default allowGroqFallback to false for score_job to prevent silent degraded evaluation
  const allowFallback = options.allowGroqFallback ?? (taskType === "score_job" ? false : true);

  const order = preferred === "gemini"
    ? (allowFallback ? ["gemini", "groq"] : ["gemini"])
    : (allowFallback ? ["groq", "gemini"] : ["groq"]);

  let lastError = null;

  for (const provider of order) {
    if (Date.now() < providerHealth[provider].until) {
      const remainingSec = Math.ceil((providerHealth[provider].until - Date.now()) / 1000);
      logLLM(`[Circuit Breaker] Skipping ${provider} (cooling down, ${remainingSec}s remaining).`);
      continue;
    }

    try {
      if (provider === "gemini") {
        return await executeGeminiWithPacing(messages, options);
      } else {
        return await callGroq(messages, options);
      }
    } catch (err) {
      lastError = err;
      const info = classifyError(provider, err);
      updateProviderHealth(provider, info);
      logLLM(`[LLM] ${provider} error (${info.kind}): ${info.message.slice(0, 100)}`);
    }
  }

  const nextAvailable = Math.min(
    providerHealth.gemini.until || Infinity,
    providerHealth.groq.until || Infinity
  );

  const resetMsg = Number.isFinite(nextAvailable) && nextAvailable > Date.now()
    ? `Available again around ${new Date(nextAvailable).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
    : "Both providers are currently exhausted or unavailable";

  throw new QuotaExhaustedError(`All LLM providers exhausted: ${resetMsg}. Last error: ${lastError?.message || ""}`, nextAvailable);
}
