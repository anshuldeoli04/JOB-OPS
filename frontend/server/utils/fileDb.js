import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function ensureJsonFile(fileUrl, fallbackValue) {
  const resolved = fileUrl instanceof URL ? fileUrl : new URL(fileUrl, import.meta.url);
  const filePath = fileURLToPath(resolved);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, 'utf8');
  } catch {
    await writeFile(filePath, JSON.stringify(fallbackValue, null, 2));
  }
}

export async function readJson(fileUrl, fallbackValue) {
  try {
    const raw = await readFile(fileUrl, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

export async function writeJson(fileUrl, value) {
  const resolved = fileUrl instanceof URL ? fileUrl : new URL(fileUrl, import.meta.url);
  const filePath = fileURLToPath(resolved);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2));
  await rename(tmpPath, filePath);
}
