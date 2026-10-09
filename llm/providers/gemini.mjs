import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRetryAfterMs, trackGeminiCall } from "../../config-utils.mjs";
import { getActiveGeminiKey } from "../keyManager.mjs";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const _clientCache = new Map();
export function getGenAIClient(apiKey) {
  if (!_clientCache.has(apiKey)) {
    _clientCache.set(apiKey, new GoogleGenerativeAI(apiKey));
  }
  return _clientCache.get(apiKey);
}

export function messagesToContents(messages) {
  if (typeof messages === "string") {
    return [{ role: "user", parts: [{ text: messages }] }];
  }
  if (!Array.isArray(messages)) {
    return [{ role: "user", parts: [{ text: String(messages || "") }] }];
  }
  return messages.map((msg) => {
    if (typeof msg === "string") return { role: "user", parts: [{ text: msg }] };
    return {
      role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
      parts: [{ text: msg.content || "" }],
    };
  });
}

function messagesToPrompt(messages) {
  if (typeof messages === "string") return messages;
  if (!Array.isArray(messages)) return String(messages || "");
  return messages
    .map((message) => {
      if (typeof message === "string") return message;
      const role = message.role ? `${message.role.toUpperCase()}:\n` : "";
      return `${role}${message.content || ""}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function parseGeminiErrorDetails(error) {
  let details = Array.isArray(error?.errorDetails) ? error.errorDetails : [];

  if ((!details || details.length === 0) && typeof error?.message === "string") {
    const jsonMatch = error.message.match(/\[\s*\{.*"@type".*\}\s*\]/s);
    if (jsonMatch) {
      try {
        details = JSON.parse(jsonMatch[0]);
      } catch {}
    }
  }

  let quotaFailure = null;
  let retryInfo = null;
  let errorInfo = null;

  for (const item of details) {
    const type = String(item?.["@type"] || "");
    if (type.includes("QuotaFailure") || item?.violations) {
      quotaFailure = item;
    } else if (type.includes("RetryInfo") || item?.retryDelay) {
      retryInfo = item;
    } else if (type.includes("ErrorInfo") || item?.reason) {
      errorInfo = item;
    }
  }

  let quotaId = "";
  if (quotaFailure && Array.isArray(quotaFailure.violations) && quotaFailure.violations.length > 0) {
    quotaId = quotaFailure.violations.map((v) => v.quotaId || "").filter(Boolean).join(",");
  }

  let retryDelayMs = null;
  if (retryInfo?.retryDelay) {
    if (typeof retryInfo.retryDelay === "string") {
      const match = retryInfo.retryDelay.match(/([0-9.]+)\s*s?/i);
      if (match) {
        retryDelayMs = Math.round(parseFloat(match[1]) * 1000);
      }
    } else if (typeof retryInfo.retryDelay === "object") {
      const sec = Number(retryInfo.retryDelay.seconds || 0);
      const nanos = Number(retryInfo.retryDelay.nanos || 0);
      retryDelayMs = sec * 1000 + Math.round(nanos / 1e6);
    } else if (typeof retryInfo.retryDelay === "number") {
      retryDelayMs = retryInfo.retryDelay * 1000;
    }
  }

  return {
    details,
    quotaFailure,
    retryInfo,
    errorInfo,
    quotaId,
    retryDelayMs,
    reason: errorInfo?.reason || "",
  };
}

export function normalizeGeminiError(error) {
  const message = String(error?.message || "");
  const status = Number(error?.status || 0);
  error.provider = "gemini";

  const { quotaId, retryDelayMs, reason } = parseGeminiErrorDetails(error);

  if (
    status === 401 ||
    status === 403 ||
    reason === "API_KEY_INVALID" ||
    /api_key_invalid|invalid api key|permission_denied|unauthenticated/i.test(message)
  ) {
    error.kind = "auth";
    error.status = status || 401;
    return error;
  }

  const is429 =
    status === 429 ||
    /resource_exhausted|429/i.test(message) ||
    reason === "RATE_LIMIT_EXCEEDED" ||
    Boolean(quotaId);

  if (is429) {
    error.status = 429;
    error.quotaId = quotaId;

    const quotaIdLower = quotaId.toLowerCase();
    if (quotaIdLower.includes("perday") || quotaIdLower.includes("daily") || /per[_\s-]?day/i.test(quotaId)) {
      error.kind = "quota_day";
      error.retryAfterMs = null;
    } else if (quotaIdLower.includes("perminute") || /per[_\s-]?minute|rpm/i.test(quotaId)) {
      error.kind = "rate_minute";
      const delay = retryDelayMs ?? getRetryAfterMs(error);
      error.retryAfterMs = Math.min(Math.max(delay || 20000, 5000), 60000);
    } else if (/quota.*day|daily.*quota|per[_\s-]?day/i.test(message)) {
      error.kind = "quota_day";
      error.retryAfterMs = null;
    } else {
      // 429 with no readable detail or general per-minute message -> treat as rate_minute with 30s cooldown
      error.kind = "rate_minute";
      const delay = retryDelayMs ?? getRetryAfterMs(error);
      error.retryAfterMs = Math.min(Math.max(delay || 30000, 5000), 60000);
    }

    return error;
  }

  if (status >= 500 || /500|503|unavailable|overloaded|internal/i.test(message)) {
    error.kind = "server";
    error.status = status || 503;
    return error;
  }

  error.kind = "other";
  return error;
}

export function resolveGeminiApiKey(options = {}) {
  return String(options.apiKey || options.config?.gemini_api_key || getActiveGeminiKey() || "").trim();
}

export async function callGemini(messages, options = {}) {
  const apiKey = resolveGeminiApiKey(options);
  if (!apiKey) {
    throw new Error("Gemini API key missing. Set GEMINI_API_KEY in .env.");
  }

  const modelName = options.model || options.config?.gemini_model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const genAI = getGenAIClient(apiKey);

  const responseMimeType =
    options.responseMimeType ||
    (options.responseFormat?.type === "json_object" ? "application/json" : undefined);

  // Default to zero thinking tokens for fast, deterministic JSON responses
  const thinkingConfig =
    options.thinkingBudget !== undefined
      ? { thinkingBudget: options.thinkingBudget }
      : { thinkingBudget: 0 };

  const systemMessage = Array.isArray(messages) ? messages.find((m) => m?.role === "system") : null;
  const nonSystemMessages = Array.isArray(messages) ? messages.filter((m) => m?.role !== "system") : messages;
  const systemInstruction = options.systemInstruction || systemMessage?.content || undefined;

  const model = genAI.getGenerativeModel({
    model: modelName,
    ...(systemInstruction ? { systemInstruction } : {}),
    generationConfig: {
      temperature: options.temperature ?? 0.1,
      maxOutputTokens: options.max_tokens || options.maxOutputTokens || 1024,
      ...(responseMimeType ? { responseMimeType } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  });

  try {
    const contents = messagesToContents(nonSystemMessages);
    const response = await model.generateContent({ contents });
    trackGeminiCall(null, { success: true });

    const candidate = response.response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      const truncErr = new Error("Gemini output truncated: maximum output tokens reached");
      truncErr.kind = "truncated";
      truncErr.status = 400;
      truncErr.provider = "gemini";
      truncErr.finishReason = "MAX_TOKENS";
      throw truncErr;
    }

    const resultText = response.response.text();
    const resultObj = {
      text: resultText,
      provider: "gemini",
      model: modelName,
      finishReason,
      usageMetadata: response.response.usageMetadata,
      toString() {
        return resultText;
      },
      [Symbol.toPrimitive]() {
        return resultText;
      },
    };
    return resultObj;
  } catch (error) {
    trackGeminiCall(null, { success: false });
    throw normalizeGeminiError(error);
  }
}
