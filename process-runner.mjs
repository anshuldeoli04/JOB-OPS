import { spawn } from "node:child_process";

export const ALLOWED_ENV_VARS = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SYSTEMROOT",
  "NODE_ENV",
  "NODE_PATH",
  "GEMINI_MODEL",
  "GROQ_MODEL",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "JOB_OPS_DATA_DIR",
  "JOB_OPS_USER_ID",
  "MIN_DELAY_MS",
  "MAX_DELAY_MS",
  "RUN_LIMIT",
  "MAX_PAGES",
  "CI",
  "FORCE_COLOR"
];

export const EXCLUDED_ENV_PATTERNS = [
  /^SESSION_SECRET$/i,
  /^ENCRYPTION_/i,
  /^API_KEY_ENCRYPTION_SECRET$/i,
  /^DB_/i,
  /^DATABASE_/i
];

export function sanitizeChildEnv(sourceEnv = process.env, extraEnv = {}) {
  const cleanEnv = {};

  for (const key of ALLOWED_ENV_VARS) {
    if (sourceEnv[key] !== undefined) {
      cleanEnv[key] = sourceEnv[key];
    }
  }

  for (const [key, val] of Object.entries(sourceEnv)) {
    if (key.toUpperCase().startsWith("PLAYWRIGHT_")) {
      cleanEnv[key] = val;
    }
  }

  for (const [key, val] of Object.entries(extraEnv)) {
    if (val !== undefined) {
      cleanEnv[key] = String(val);
    }
  }

  for (const pattern of EXCLUDED_ENV_PATTERNS) {
    for (const key of Object.keys(cleanEnv)) {
      if (pattern.test(key)) {
        delete cleanEnv[key];
      }
    }
  }

  cleanEnv.FORCE_COLOR = "0";
  return cleanEnv;
}

export function runNodeScript(script, extraArgs = [], options = {}) {
  const { stdio, timeoutMs = 0, onTimeout, env = {}, onLog, silent = false } = options;
  const logs = [];
  const childStdio = stdio || ["pipe", "pipe", "pipe"];

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...extraArgs], {
      stdio: childStdio,
      env: sanitizeChildEnv(process.env, env),
    });

    if (options.stdinText && child.stdin) {
      child.stdin.write(options.stdinText);
      child.stdin.end();
    }

    let settled = false;
    let forceKillTimer = null;
    let timeoutTriggered = false;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ code: timeoutTriggered ? 1 : (code ?? 1), logs });
    };

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        if (!silent && stdio !== "pipe") {
          process.stdout.write(chunk);
        }
        const lines = text.split(/\r?\n/).filter(Boolean);
        logs.push(...lines);
        lines.forEach((line) => onLog?.(line, "stdout"));
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        if (!silent && stdio !== "pipe") {
          process.stderr.write(chunk);
        }
        const lines = text.split(/\r?\n/).filter(Boolean);
        logs.push(...lines);
        lines.forEach((line) => onLog?.(line, "stderr"));
      });
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          timeoutTriggered = true;
          onTimeout?.();
          child.kill("SIGTERM");
          forceKillTimer = setTimeout(() => {
            if (!settled) {
              child.kill("SIGKILL");
              finish(1);
            }
          }, 1500);
        }, timeoutMs)
      : null;

    child.on("close", (code) => {
      finish(timeoutTriggered ? 1 : code);
    });

    child.on("error", () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      finish(1);
    });
  });
}
