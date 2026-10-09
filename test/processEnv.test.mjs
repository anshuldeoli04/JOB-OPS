import test from "node:test";
import assert from "node:assert/strict";
import { runNodeScript, sanitizeChildEnv, ALLOWED_ENV_VARS, EXCLUDED_ENV_PATTERNS } from "../process-runner.mjs";

test("T5: sanitizeChildEnv unit verification excludes secret env vars and keeps allowlisted vars", () => {
  const dirtyEnv = {
    PATH: "C:\\Windows\\system32;C:\\Program Files\\nodejs",
    NODE_ENV: "production",
    GEMINI_API_KEY: "AIzaDummyKey12345",
    GROQ_API_KEY: "gsk_DummyKey12345",
    SESSION_SECRET: "top-secret-session-secret-at-least-32-chars",
    ENCRYPTION_KEY: "top-secret-encryption-key",
    ENCRYPTION_SALT: "top-secret-encryption-salt",
    API_KEY_ENCRYPTION_SECRET: "top-secret-api-key-secret",
    DB_PASSWORD: "secret-db-password",
    DB_HOST: "db.internal.local",
    DB_USER: "postgres",
    DB_NAME: "jobops",
    DATABASE_URL: "postgres://user:pass@db:5432/jobops",
    PLAYWRIGHT_BROWSERS_PATH: "0",
    RANDOM_UNKNOWN_VAR: "should_be_omitted",
    ANTHROPIC_API_KEY: "sk-ant-dummy-secret",
    GEMINI_API_KEYS: "AIzaDummy1,AIzaDummy2",
    GROQ_API_KEYS: "gsk_Dummy1,gsk_Dummy2"
  };

  const clean = sanitizeChildEnv(dirtyEnv);
  const cleanKeys = Object.keys(clean);

  // Assert dead & unrelated vendor variables are absent
  assert.strictEqual(clean.ANTHROPIC_API_KEY, undefined);
  assert.strictEqual(clean.GEMINI_API_KEYS, undefined);
  assert.strictEqual(clean.GROQ_API_KEYS, undefined);
  assert.ok(!ALLOWED_ENV_VARS.includes("ANTHROPIC_API_KEY"));
  assert.ok(!ALLOWED_ENV_VARS.includes("GEMINI_API_KEYS"));
  assert.ok(!ALLOWED_ENV_VARS.includes("GROQ_API_KEYS"));

  // Assert excluded variables are absent
  assert.strictEqual(clean.SESSION_SECRET, undefined);
  assert.strictEqual(clean.ENCRYPTION_KEY, undefined);
  assert.strictEqual(clean.ENCRYPTION_SALT, undefined);
  assert.strictEqual(clean.API_KEY_ENCRYPTION_SECRET, undefined);
  assert.strictEqual(clean.DB_PASSWORD, undefined);
  assert.strictEqual(clean.DB_HOST, undefined);
  assert.strictEqual(clean.DB_USER, undefined);
  assert.strictEqual(clean.DB_NAME, undefined);
  assert.strictEqual(clean.DATABASE_URL, undefined);
  assert.strictEqual(clean.RANDOM_UNKNOWN_VAR, undefined);

  // Assert allowed variables are retained
  assert.strictEqual(clean.PATH, dirtyEnv.PATH);
  assert.strictEqual(clean.NODE_ENV, "production");
  assert.strictEqual(clean.GEMINI_API_KEY, "AIzaDummyKey12345");
  assert.strictEqual(clean.GROQ_API_KEY, "gsk_DummyKey12345");
  assert.strictEqual(clean.PLAYWRIGHT_BROWSERS_PATH, "0");
  assert.strictEqual(clean.FORCE_COLOR, "0");
});

test("T5: runNodeScript executes subprocess with sanitized environment", async () => {
  // Set excluded variables in current process.env
  process.env.SESSION_SECRET = "super-secret-session-token-32-chars-long";
  process.env.ENCRYPTION_KEY = "super-secret-encryption-key-for-test";
  process.env.ENCRYPTION_SALT = "super-secret-salt-for-test";
  process.env.API_KEY_ENCRYPTION_SECRET = "super-secret-api-key-enc";
  process.env.DB_PASSWORD = "super-secret-postgres-password";
  process.env.DB_HOST = "internal-db.example.com";
  process.env.DATABASE_URL = "postgres://admin:secret@host/db";
  process.env.GEMINI_API_KEY = "test-gemini-api-key-visible";

  const { logs } = await runNodeScript("test/fixtures/printEnv.mjs");
  const jsonLine = logs.find((l) => l.startsWith("[") && l.endsWith("]"));
  assert.ok(jsonLine, "Expected JSON array of environment variable keys from child process");

  const childKeys = JSON.parse(jsonLine);

  // Assert secrets are NOT inherited by child
  assert.ok(!childKeys.includes("SESSION_SECRET"), "SESSION_SECRET must not appear in child process");
  assert.ok(!childKeys.includes("ENCRYPTION_KEY"), "ENCRYPTION_KEY must not appear in child process");
  assert.ok(!childKeys.includes("ENCRYPTION_SALT"), "ENCRYPTION_SALT must not appear in child process");
  assert.ok(!childKeys.includes("API_KEY_ENCRYPTION_SECRET"), "API_KEY_ENCRYPTION_SECRET must not appear in child process");
  assert.ok(!childKeys.includes("DB_PASSWORD"), "DB_PASSWORD must not appear in child process");
  assert.ok(!childKeys.includes("DB_HOST"), "DB_HOST must not appear in child process");
  assert.ok(!childKeys.includes("DATABASE_URL"), "DATABASE_URL must not appear in child process");

  // Assert runtime & LLM key ARE passed
  assert.ok(childKeys.some((k) => k.toLowerCase() === "path"), "PATH must appear in child process");
  assert.ok(childKeys.includes("GEMINI_API_KEY"), "GEMINI_API_KEY must appear in child process");
});
