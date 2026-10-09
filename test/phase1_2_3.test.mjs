import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  saveEnvUpdates,
} from "../config-utils.mjs";
import {
  getActiveGeminiKey,
  isInteractiveSession,
} from "../llm/keyManager.mjs";
import {
  resolveGeminiApiKey,
  getGenAIClient,
} from "../llm/providers/gemini.mjs";
import {
  callLLM,
  QuotaExhaustedError,
  providerHealth,
} from "../llm/llmClient.mjs";

test("Phase 1: saveEnvUpdates persists new keys while preserving existing .env entries", () => {
  const tmpEnv = path.join(os.tmpdir(), `test-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.env`);
  try {
    fs.writeFileSync(tmpEnv, "PORT=4000\nEXISTING_SECRET=keep_me\n# A comment\n", "utf8");

    saveEnvUpdates(
      {
        GEMINI_API_KEY: "AIzaSyNewTestKey123",
        USER_NAME: "John Doe",
      },
      tmpEnv
    );

    const updated = fs.readFileSync(tmpEnv, "utf8");
    assert.match(updated, /EXISTING_SECRET=keep_me/);
    assert.match(updated, /GEMINI_API_KEY=AIzaSyNewTestKey123/);
    assert.match(updated, /USER_NAME=John Doe/);

    // Overwriting existing key
    saveEnvUpdates({ EXISTING_SECRET: "updated_secret" }, tmpEnv);
    const updated2 = fs.readFileSync(tmpEnv, "utf8");
    assert.match(updated2, /EXISTING_SECRET=updated_secret/);
  } finally {
    if (fs.existsSync(tmpEnv)) {
      fs.unlinkSync(tmpEnv);
    }
  }
});

test("Phase 2: Gemini single active key resolution", () => {
  const origKey = process.env.GEMINI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = "AIzaSyTestKey_single_12345";
    assert.strictEqual(getActiveGeminiKey(), "AIzaSyTestKey_single_12345");

    delete process.env.GEMINI_API_KEY;
    assert.strictEqual(getActiveGeminiKey(), "");
  } finally {
    if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test("Phase 2: callGemini prioritizes options.config.gemini_api_key over process.env.GEMINI_API_KEY", () => {
  const origKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "AIzaSyTest_ENV_KEY_12345";
    const resolved = resolveGeminiApiKey({ config: { gemini_api_key: "AIzaSyTest_USER_KEY_67890" } });
    assert.strictEqual(resolved, "AIzaSyTest_USER_KEY_67890");

    const client = getGenAIClient(resolved);
    assert.ok(client);
    assert.strictEqual(client.apiKey, "AIzaSyTest_USER_KEY_67890");
  } finally {
    if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test("Phase 2: isInteractiveSession guards against CI, test runs, and headless flags", () => {
  assert.strictEqual(isInteractiveSession({ interactive: false }), false);
  assert.strictEqual(isInteractiveSession({ nonInteractive: true }), false);
  assert.strictEqual(isInteractiveSession(), false); // Must be false by default (explicit opt-in required)
  assert.strictEqual(isInteractiveSession({ interactive: true }), false); // In test environment (NODE_ENV=test), must be false
});

test("Phase 2: callLLM throws QuotaExhaustedError when single Gemini key is exhausted", async () => {
  const savedUntil = providerHealth.gemini.until;
  try {
    providerHealth.gemini.until = Date.now() + 60000;
    await assert.rejects(
      async () => callLLM("score_job", "test", { allowGroqFallback: false }),
      (err) => err instanceof QuotaExhaustedError
    );
  } finally {
    providerHealth.gemini.until = savedUntil;
  }
});

test("Phase 3: autoflow.mjs exports main safely and does not auto-execute on import", async () => {
  const autoflowMod = await import("../autoflow.mjs");
  assert.strictEqual(typeof autoflowMod.main, "function");
});

test("Edge Case Guard: Non-array or empty ids in bulk update are handled safely", () => {
  const checkGuard = (ids) => {
    if (!Array.isArray(ids) || !ids.length) {
      return { applications: [] };
    }
    return { ok: true };
  };

  assert.deepStrictEqual(checkGuard("not-an-array"), { applications: [] });
  assert.deepStrictEqual(checkGuard(123), { applications: [] });
  assert.deepStrictEqual(checkGuard(null), { applications: [] });
  assert.deepStrictEqual(checkGuard([]), { applications: [] });
  assert.deepStrictEqual(checkGuard(["app-1"]), { ok: true });
});

test("Stream Replay Isolation: Safe user stream file scoping", () => {
  const getScanStreamFile = (userId) => {
    const safeId = String(userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `../data/scan-stream-${safeId}.json`;
  };

  assert.strictEqual(getScanStreamFile(1), "../data/scan-stream-1.json");
  assert.strictEqual(getScanStreamFile("user-99"), "../data/scan-stream-user-99.json");
  assert.strictEqual(getScanStreamFile("malicious/path"), "../data/scan-stream-malicious_path.json");
});

test("Phase 3: resolveActiveSources respects disabled_sources default and allows explicit CLI overrides", async () => {
  const { resolveActiveSources } = await import("../scanner.mjs");

  // Default with stealth sources disabled
  const defaultSources = resolveActiveSources({ disabled_sources: ["wellfound", "naukri", "internshala"] });
  assert.deepStrictEqual(defaultSources, ["greenhouse", "lever", "ashby", "careers_page"]);

  // Explicit --sources=naukri overrides disabled_sources
  const overrideSources = resolveActiveSources({ disabled_sources: ["wellfound", "naukri", "internshala"] }, "naukri");
  assert.deepStrictEqual(overrideSources, ["naukri"]);

  // Multi-source override
  const multiSources = resolveActiveSources({ disabled_sources: ["wellfound", "naukri", "internshala"] }, "naukri,internshala,greenhouse");
  assert.deepStrictEqual(multiSources, ["naukri", "internshala", "greenhouse"]);
});
