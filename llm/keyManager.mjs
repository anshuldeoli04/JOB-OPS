/**
 * JOB-OPS Key & Quota Management Layer
 *
 * Provides:
 * 1. Single active Gemini key resolution
 * 2. Opt-in interactive quota resolution menu for CLI sessions
 * 3. Atomic .env persistence and circuit-breaker reset
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { normalizeGeminiError } from "./providers/gemini.mjs";

export function getActiveGeminiKey() {
  return (process.env.GEMINI_API_KEY || "").trim();
}

export function isInteractiveSession(options = {}) {
  // Opt-in: only interactive if explicitly requested by caller
  if (options.interactive !== true) return false;
  if (options.nonInteractive === true) return false;
  if (process.env.CI || process.env.NODE_ENV === "test") return false;
  if (
    process.argv.includes("--ci") ||
    process.argv.includes("--headless") ||
    process.argv.includes("--non-interactive")
  ) {
    return false;
  }
  return Boolean(process.stdin?.isTTY && process.stdout?.isTTY);
}

export async function verifyGeminiKeyPing(apiKey, modelName = "gemini-2.5-flash") {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("Gemini API key is empty.");
  }
  const cleanKey = apiKey.trim();
  const genAI = new GoogleGenerativeAI(cleanKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  try {
    const result = await model.generateContent("Reply with only: OK");
    return Boolean(result?.response?.text());
  } catch (rawError) {
    const err = normalizeGeminiError(rawError);
    if (err.kind === "auth") {
      throw new Error(`Authentication failed: ${rawError.message}`);
    }
    if (err.kind === "quota_day" || err.kind === "rate_minute") {
      // Key is valid authentication-wise, but currently quota/rate limited
      return true;
    }
    throw rawError;
  }
}

export async function verifyGroqKeyPing(apiKey) {
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

