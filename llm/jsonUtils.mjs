/**
 * Safe JSON parser resilient to LLM markdown formatting, code fences,
 * trailing commas, comments, and extra conversational text.
 */
export function safeJsonParse(rawInput, fallback = null) {
  const rawText =
    typeof rawInput === "string"
      ? rawInput
      : typeof rawInput?.text === "string"
      ? rawInput.text
      : rawInput
      ? String(rawInput)
      : "";
  if (!rawText) return fallback;
  let text = rawText.trim();

  // 1. Extract content from markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // 2. Attempt direct parse
  try {
    return JSON.parse(text);
  } catch {}

  // 3. Extract JSON object { ... }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}

    // Remove trailing commas and comments
    const sanitized = candidate
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    try {
      return JSON.parse(sanitized);
    } catch {}
  }

  // 4. Extract JSON array [ ... ]
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = text.substring(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {}

    const sanitized = candidate
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    try {
      return JSON.parse(sanitized);
    } catch {}
  }

  if (fallback !== null) return fallback;
  throw new Error(`Failed to parse LLM JSON: ${text.slice(0, 120)}`);
}
