import fs from "fs";
import path from "path";

export function syncSleep(ms) {
  const target = Date.now() + ms;
  while (Date.now() < target) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, target - Date.now()));
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeFileStem(value, fallback = "report") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function loadJsonFile(filePath, { fallback = null, warnMessage } = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    if (warnMessage) console.warn(`${warnMessage}: ${error.message}`);
    return fallback;
  }
}

export async function withFileLock(filePath, callback, { timeoutMs = 10000, retryMs = 50, staleLockMs = 30000 } = {}) {
  const lockPath = `${filePath}.lock`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
      fs.closeSync(fd);
      try {
        return await callback();
      } finally {
        try { fs.unlinkSync(lockPath); } catch {}
      }
    } catch (err) {
      if (err.code === "EEXIST") {
        try {
          const stats = fs.statSync(lockPath);
          if (Date.now() - stats.mtimeMs > staleLockMs) {
            try { fs.unlinkSync(lockPath); } catch {}
            continue;
          }
        } catch {}
        await sleep(retryMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Lock acquisition timed out for ${filePath}`);
}

export function withFileLockSync(filePath, callback, { timeoutMs = 10000, retryMs = 50, staleLockMs = 30000 } = {}) {
  const lockPath = `${filePath}.lock`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
      fs.closeSync(fd);
      try {
        return callback();
      } finally {
        try { fs.unlinkSync(lockPath); } catch {}
      }
    } catch (err) {
      if (err.code === "EEXIST") {
        try {
          const stats = fs.statSync(lockPath);
          if (Date.now() - stats.mtimeMs > staleLockMs) {
            try { fs.unlinkSync(lockPath); } catch {}
            continue;
          }
        } catch {}
        syncSleep(retryMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Lock acquisition timed out for ${filePath}`);
}

function writeJsonFileAtomicUnlocked(filePath, value) {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  fs.writeFileSync(tempFile, `${serialized}\n`, "utf8");
  try {
    fs.renameSync(tempFile, filePath);
  } catch {
    let renamed = false;
    for (let i = 0; i < 10; i++) {
      try {
        syncSleep(20);
        fs.renameSync(tempFile, filePath);
        renamed = true;
        break;
      } catch {}
    }
    if (!renamed) {
      fs.copyFileSync(tempFile, filePath);
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
}

export function writeJsonFileAtomic(filePath, value, { lock = true } = {}) {
  if (lock) {
    return withFileLockSync(filePath, () => writeJsonFileAtomicUnlocked(filePath, value));
  }
  return writeJsonFileAtomicUnlocked(filePath, value);
}
