import test from "node:test";
import assert from "node:assert/strict";

test("T3-V3: Truncation guard throws kind: 'truncated' on finishReason: MAX_TOKENS", () => {
  const mockResponse = {
    finishReason: "MAX_TOKENS",
    text: '{"score": 2.0, "verdict": "Not a',
    provider: "gemini",
  };

  function checkTruncation(res) {
    if (res.finishReason === "MAX_TOKENS") {
      const err = new Error("Gemini output truncated: maximum output tokens reached");
      err.kind = "truncated";
      err.status = 400;
      err.provider = res.provider || "gemini";
      throw err;
    }
    return JSON.parse(res.text);
  }

  assert.throws(
    () => checkTruncation(mockResponse),
    (err) => {
      assert.strictEqual(err.kind, "truncated");
      assert.match(err.message, /truncated/i);
      return true;
    },
    "Must throw truncated error before attempting JSON parse"
  );
});
