import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));

export async function readWorkspaceJson(relativePath, fallbackValue) {
  try {
    const raw = await readFile(path.join(workspaceRoot, relativePath), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

export async function writeWorkspaceJson(relativePath, value) {
  await writeFile(path.join(workspaceRoot, relativePath), JSON.stringify(value, null, 2));
}
