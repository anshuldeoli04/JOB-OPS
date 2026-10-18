import { spawn } from 'node:child_process';
import { getWorkspacePath } from './userWorkspace.js';

export const ALLOWED_ENV_VARS = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'SystemRoot',
  'SYSTEMROOT',
  'NODE_ENV',
  'NODE_PATH',
  'GEMINI_MODEL',
  'GROQ_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_API_KEYS',
  'GROQ_API_KEY',
  'GROQ_API_KEYS',
  'ANTHROPIC_API_KEY',
  'JOB_OPS_DATA_DIR',
  'JOB_OPS_USER_ID',
  'MIN_DELAY_MS',
  'MAX_DELAY_MS',
  'RUN_LIMIT',
  'MAX_PAGES',
  'CI'
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
    if (key.toUpperCase().startsWith('PLAYWRIGHT_')) {
      cleanEnv[key] = val;
    }
  }

  for (const [key, val] of Object.entries(extraEnv)) {
    if (val !== undefined) {
      cleanEnv[key] = String(val);
    }
  }

  for (const key of Object.keys(cleanEnv)) {
    if (EXCLUDED_ENV_PATTERNS.some((pattern) => pattern.test(key))) {
      delete cleanEnv[key];
    }
  }

  cleanEnv.FORCE_COLOR = '0';
  return cleanEnv;
}

export async function runNodeScript(scriptName, args = [], options = {}) {
  const cwd = getWorkspacePath();
  const scriptPath = getWorkspacePath(scriptName);
  const logs = [];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: sanitizeChildEnv(process.env, options.env || {})
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText);
      child.stdin.end();
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/).filter(Boolean);
      logs.push(...lines);
      lines.forEach((line) => options.onLog?.(line, 'stdout'));
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/).filter(Boolean);
      logs.push(...lines);
      lines.forEach((line) => options.onLog?.(line, 'stderr'));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, logs });
      } else {
        const error = new Error(logs.slice(-12).join('\n') || `${scriptName} failed with code ${code}`);
        error.logs = logs;
        reject(error);
      }
    });
  });
}
