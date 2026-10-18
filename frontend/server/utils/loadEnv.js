import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function loadLocalEnv() {
  const envPaths = [
    path.resolve(repoRoot, '.env.local'),
    path.resolve(repoRoot, '.env'),
    path.resolve(repoRoot, 'frontend/server/.env.local'),
    path.resolve(repoRoot, 'frontend/server/.env'),
    path.resolve(process.cwd(), '../.env.local'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'server/.env.local'),
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(process.cwd(), 'frontend/server/.env.local'),
    path.resolve(process.cwd(), 'frontend/server/.env')
  ];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) continue;
      const key = trimmed.slice(0, equalIndex).trim();
      const value = trimmed.slice(equalIndex + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
