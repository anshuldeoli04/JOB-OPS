import { logLLM } from "../logger.mjs";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_GROQ_MIN_DELAY_MS = 2000;
const DEFAULT_GROQ_MAX_OUTPUT_TOKENS = 2048;

let lastGroqCallAt = 0;
let groqRateLimitState = {
  remainingRequests: null,
  remainingTokens: null,
  resetRequestsMs: 0,
  resetTokensMs: 0,
  updatedAt: 0,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMessages(messages) {
  if (typeof messages === "string") {
    return [{ role: "user", content: messages }];
  }
  if (!Array.isArray(messages)) {
    return [{ role: "user", content: String(messages || "") }];
  }
  return messages.map((message) =>
    typeof message === "string" ? { role: "user", content: message } : message
  );
}

function parseHeaderNumber(headers, name) {
  const value = headers.get(name);
  if (value === null) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.ceil(Number(raw) * 1000);

  let totalMs = 0;
  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/gi;
  for (const match of raw.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "ms") totalMs += amount;
    if (unit === "s") totalMs += amount * 1000;
    if (unit === "m") totalMs += amount * 60 * 1000;
    if (unit === "h") totalMs += amount * 60 * 60 * 1000;
  }
  return Math.ceil(totalMs);
}

const DEFAULT_GROQ_TPM_LIMIT = 6000; // Conservative fallback

export function getGroqDelay(responseHeaders) {
  if (!responseHeaders) return 0;
  const getHeader = (key) =>
    typeof responseHeaders.get === "function" ? responseHeaders.get(key) : responseHeaders[key];

  const remainingHeader = getHeader("x-ratelimit-remaining-tokens");
  const resetHeader = getHeader("x-ratelimit-reset-tokens");

  const remaining = parseInt(remainingHeader ?? DEFAULT_GROQ_TPM_LIMIT, 10);
  const resetMs = parseDurationMs(resetHeader);

  if (remaining < 1000 && resetMs > 0) {
    return resetMs; // Wait for reset in ms
  }
  return 0; // Enough tokens remaining
}

function updateGroqRateLimitState(headers) {
  const dynamicDelayMs = getGroqDelay(headers);
  const remainingToks = parseHeaderNumber(headers, "x-ratelimit-remaining-tokens");
  const resetToksMs = dynamicDelayMs || parseDurationMs(headers.get("x-ratelimit-reset-tokens"));

  groqRateLimitState = {
    remainingRequests: parseHeaderNumber(headers, "x-ratelimit-remaining-requests"),
    remainingTokens: remainingToks,
    resetRequestsMs: parseDurationMs(headers.get("x-ratelimit-reset-requests")),
    resetTokensMs: resetToksMs,
    updatedAt: Date.now(),
  };

  if (remainingToks !== null) {
    logLLM(`[Groq TPM] Tokens remaining: ${remainingToks}, reset in: ${Math.ceil(resetToksMs / 1000)}s`);
  }
}

function getGroqPreflightWaitMs() {
  if (groqRateLimitState.remainingRequests === 0 && groqRateLimitState.resetRequestsMs > 0) {
    return groqRateLimitState.resetRequestsMs;
  }
  if (groqRateLimitState.remainingTokens !== null && groqRateLimitState.remainingTokens < 1000 && groqRateLimitState.resetTokensMs > 0) {
    logLLM(
      `[Groq TPM] Tokens low (${groqRateLimitState.remainingTokens} < 1000). Pausing ${groqRateLimitState.resetTokensMs}ms for TPM reset...`
    );
    return groqRateLimitState.resetTokensMs;
  }
  return 0;
}

export async function callGroq(messages, options = {}) {
  const apiKey = String(options.apiKey || options.config?.groq_api_key || process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Groq API key missing. Set GROQ_API_KEY in .env.");
  }

  const minDelayMs = Number(options.groqMinDelayMs || process.env.GROQ_MIN_DELAY_MS || DEFAULT_GROQ_MIN_DELAY_MS);
  const elapsedMs = Date.now() - lastGroqCallAt;
  if (lastGroqCallAt && elapsedMs < minDelayMs) {
    await sleep(minDelayMs - elapsedMs);
  }
  const preflightWaitMs = getGroqPreflightWaitMs();
  if (preflightWaitMs > 30000) {
    const error = new Error(`Groq TPM cooldown active (${Math.ceil(preflightWaitMs / 1000)}s)`);
    error.status = 429;
    error.provider = "groq";
    error.kind = "rate_minute";
    error.retryAfterMs = preflightWaitMs;
    throw error;
  }
  if (preflightWaitMs > 0) {
    await sleep(preflightWaitMs);
  }

  const envMaxTokens = process.env.GROQ_MAX_OUTPUT_TOKENS
    ? Number(process.env.GROQ_MAX_OUTPUT_TOKENS)
    : null;
  const requestedMaxTokens = Number(
    options.max_tokens || options.maxOutputTokens || DEFAULT_GROQ_MAX_OUTPUT_TOKENS
  );
  const maxTokens = envMaxTokens
    ? Math.min(requestedMaxTokens, envMaxTokens)
    : requestedMaxTokens;

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || options.config?.groq_model || process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      messages: normalizeMessages(messages),
      max_tokens: maxTokens,
      temperature: options.temperature ?? 0.1,
      response_format: options.responseFormat,
    }),
  });

  lastGroqCallAt = Date.now();
  updateGroqRateLimitState(response.headers);

  if (response.status === 429) {
    const error = new Error("Groq rate limited");
    error.status = 429;
    error.provider = "groq";
    const retryAfter = parseDurationMs(response.headers.get("retry-after"));
    const resetTokens = parseDurationMs(response.headers.get("x-ratelimit-reset-tokens"));
    const resetRequests = parseDurationMs(response.headers.get("x-ratelimit-reset-requests"));
    const maxReset = Math.max(retryAfter, resetTokens, resetRequests);

    // T-7: If reset is > 5 minutes away, classify as daily/hourly quota exhaustion
    if (maxReset > 5 * 60 * 1000) {
      error.kind = "quota_day";
      error.retryAfterMs = maxReset;
      error.resetUntil = Date.now() + maxReset;
    } else {
      error.kind = "rate_minute";
      error.retryAfterMs = Math.max(retryAfter || resetTokens || 10000, 5000);
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (
      response.status === 400 &&
      options.responseFormat &&
      /json_validate_failed|failed to validate json|failed to generate json/i.test(errorText)
    ) {
      logLLM("[Groq] Strict JSON mode failed on Groq. Retrying with prompt-based JSON formatting...");
      return callGroq(messages, { ...options, responseFormat: undefined });
    }
    const error = new Error(`Groq request failed (${response.status}): ${errorText.slice(0, 240)}`);
    error.status = response.status;
    error.provider = "groq";
    error.kind =
      response.status === 401 || response.status === 403
        ? "auth"
        : response.status >= 500
        ? "server"
        : "other";
    throw error;
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("Groq returned an empty response.");
  }

  // T-7 #4: Remove <think> blocks if produced by reasoning/hybrid models like Qwen
  let cleanContent = rawContent;
  if (cleanContent.includes("<think>")) {
    logLLM("[Groq] Stripping <think> block from response.");
    cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  }

  const modelUsed = data?.model || options.model || DEFAULT_GROQ_MODEL;
  return {
    text: cleanContent,
    provider: "groq",
    model: modelUsed,
    toString() {
      return cleanContent;
    },
    [Symbol.toPrimitive]() {
      return cleanContent;
    },
  };
}
