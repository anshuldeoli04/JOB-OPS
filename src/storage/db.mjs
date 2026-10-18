import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getDataDir, APPLICATIONS_FILE, SCAN_RESULTS_FILE } from "../config/configPaths.mjs";
import { writeJsonFileAtomic } from "../utils/fileLock.mjs";
import { canonicalizeUrl, jobKey } from "../../jobIdentity.mjs";

let _dbInstance = null;
let _currentDbPath = null;

export function getDatabase() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dbPath = path.resolve(dir, "job-ops.db");

  if (_dbInstance && _currentDbPath === dbPath) {
    return _dbInstance;
  }

  if (_dbInstance) {
    try { _dbInstance.close(); } catch {}
  }

  const db = new Database(dbPath, { timeout: 10000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 10000");

  initSchema(db);
  _dbInstance = db;
  _currentDbPath = dbPath;
  migrateFromJsonIfEmpty(db);
  return _dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_results (
      url TEXT PRIMARY KEY,
      job_key TEXT,
      company TEXT,
      role TEXT,
      location TEXT,
      grade TEXT,
      score REAL,
      source TEXT,
      status TEXT,
      eval_attempts INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      raw_data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_company ON scan_results(company);
    CREATE INDEX IF NOT EXISTS idx_scan_grade ON scan_results(grade);
    CREATE INDEX IF NOT EXISTS idx_scan_created ON scan_results(created_at);
    CREATE INDEX IF NOT EXISTS idx_scan_status ON scan_results(status);

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      company TEXT,
      role TEXT,
      location TEXT,
      grade TEXT,
      score REAL,
      status TEXT,
      url TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      raw_data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_apps_company ON applications(company);
    CREATE INDEX IF NOT EXISTS idx_apps_grade ON applications(grade);
    CREATE INDEX IF NOT EXISTS idx_apps_created ON applications(created_at);
    CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);
  `);
}

function migrateFromJsonIfEmpty(db) {
  const scanCount = db.prepare("SELECT COUNT(*) AS count FROM scan_results").get().count;
  if (scanCount === 0 && fs.existsSync(SCAN_RESULTS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SCAN_RESULTS_FILE, "utf8"));
      if (Array.isArray(data) && data.length > 0) {
        saveScanResultsToDb(data, false);
      }
    } catch {}
  }

  const appCount = db.prepare("SELECT COUNT(*) AS count FROM applications").get().count;
  if (appCount === 0 && fs.existsSync(APPLICATIONS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(APPLICATIONS_FILE, "utf8"));
      if (Array.isArray(data) && data.length > 0) {
        saveApplicationsToDb(data, false);
      }
    } catch {}
  }
}

export function loadScanResultsFromDb() {
  const db = getDatabase();
  const rows = db.prepare("SELECT raw_data FROM scan_results ORDER BY created_at DESC").all();
  return rows.map((r) => {
    try { return JSON.parse(r.raw_data); } catch { return null; }
  }).filter(Boolean);
}

export function saveScanResultsToDb(results = [], syncDiskJson = true) {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO scan_results (
      url, job_key, company, role, location, grade, score, source, status,
      eval_attempts, created_at, updated_at, raw_data
    ) VALUES (
      @url, @job_key, @company, @role, @location, @grade, @score, @source, @status,
      @eval_attempts, @created_at, @updated_at, @raw_data
    )
  `);

  const now = Date.now();
  const tx = db.transaction((items) => {
    for (const item of items) {
      if (!item || (!item.url && !item.link)) continue;
      const url = item.url || item.link;
      const key = jobKey(item);
      insert.run({
        url,
        job_key: key,
        company: item.company || "",
        role: item.role || item.title || "",
        location: item.location || "",
        grade: item.grade || null,
        score: typeof item.score === "number" ? item.score : null,
        source: item.source || "",
        status: item.status || "new",
        eval_attempts: Number(item.eval_attempts) || 0,
        created_at: Number(item.scanned_at || item.created_at) || now,
        updated_at: now,
        raw_data: JSON.stringify(item),
      });
    }
  });
  tx(results);

  if (syncDiskJson) {
    try {
      writeJsonFileAtomic(SCAN_RESULTS_FILE, results);
    } catch {}
  }
}

export function loadApplicationsFromDb() {
  const db = getDatabase();
  const rows = db.prepare("SELECT raw_data FROM applications ORDER BY created_at DESC").all();
  return rows.map((r) => {
    try { return JSON.parse(r.raw_data); } catch { return null; }
  }).filter(Boolean);
}

export function saveApplicationsToDb(applications = [], syncDiskJson = true) {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO applications (
      id, company, role, location, grade, score, status, url, created_at, updated_at, raw_data
    ) VALUES (
      @id, @company, @role, @location, @grade, @score, @status, @url, @created_at, @updated_at, @raw_data
    )
  `);

  const now = Date.now();
  const tx = db.transaction((apps) => {
    for (const app of apps) {
      if (!app || !app.id) continue;
      insert.run({
        id: String(app.id),
        company: app.company || "",
        role: app.role || "",
        location: app.location || "",
        grade: app.grade || null,
        score: typeof app.score === "number" ? app.score : null,
        status: app.status || "evaluated",
        url: app.url || app.apply_url || "",
        created_at: Number(app.created_at || app.evaluated_at) || now,
        updated_at: now,
        raw_data: JSON.stringify(app),
      });
    }
  });
  tx(applications);

  if (syncDiskJson) {
    try {
      writeJsonFileAtomic(APPLICATIONS_FILE, applications);
    } catch {}
  }
}

export function upsertApplicationToDb(application = {}, syncDiskJson = true) {
  if (!application || !application.id) return null;
  const db = getDatabase();
  const existing = db.prepare("SELECT raw_data FROM applications WHERE id = ?").get(String(application.id));

  let merged = { ...application };
  if (existing) {
    try {
      merged = { ...JSON.parse(existing.raw_data), ...application, updated_at: Date.now() };
    } catch {}
  }

  saveApplicationsToDb([merged], false);

  if (syncDiskJson) {
    const all = loadApplicationsFromDb();
    try {
      writeJsonFileAtomic(APPLICATIONS_FILE, all);
    } catch {}
  }

  return merged;
}
