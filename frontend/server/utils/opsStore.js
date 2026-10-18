import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
const getDataDir = () =>
  process.env.JOB_OPS_DATA_DIR ? path.resolve(process.env.JOB_OPS_DATA_DIR) : path.join(rootDir, 'data');
const getOpsFile = () => path.join(getDataDir(), 'ops-settings.json');
const getScanResultsFile = () => path.join(getDataDir(), 'scan-results.json');

const defaultSettings = {
  autoApply: {
    enabled: false,
    safeSubmitOnly: true,
    minScore: 7,
    platforms: ['greenhouse', 'lever', 'internshala']
  },
  notifications: {
    enabled: false,
    channel: 'email',
    to: '',
    minScore: 7
  },
  setupWizard: {
    complete: false
  }
};

export const roadmapPhases = [
  {
    id: 'p0',
    label: 'P0 Critical',
    status: 'managed',
    items: [
      'Gemini retry and Groq fallback are present in evaluator',
      'JSON writes use atomic locks',
      'Auto-apply is exposed in safe preview mode'
    ]
  },
  {
    id: 'p1',
    label: 'P1 Experience',
    status: 'managed',
    items: [
      'Completion notification settings are configurable',
      'Score report data is generated from saved evaluations',
      'Scraper health can be checked before batches'
    ]
  },
  {
    id: 'p2',
    label: 'P2 Differentiators',
    status: 'managed',
    items: [
      'Public output links are served over localhost',
      'Kanban status tracking is supported by application statuses',
      'Cross-platform duplicates are detected by normalized keys'
    ]
  },
  {
    id: 'p3',
    label: 'P3 Later',
    status: 'planned',
    items: [
      'Telegram bot, A/B tracking, interview sheets, and skill gap rollups stay optional'
    ]
  }
];

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function getOpsFilePath(userId = null) {
  if (userId) {
    return path.join(getDataDir(), `ops-settings-${userId}.json`);
  }
  return getOpsFile();
}

export function loadOpsSettings(userId = null) {
  const filePath = getOpsFilePath(userId);
  const data = readJson(filePath, {});
  return {
    ...defaultSettings,
    ...data,
    autoApply: {
      ...defaultSettings.autoApply,
      ...data?.autoApply
    },
    notifications: {
      ...defaultSettings.notifications,
      ...data?.notifications
    },
    setupWizard: {
      ...defaultSettings.setupWizard,
      ...data?.setupWizard
    }
  };
}

export function saveOpsSettings(patch = {}, userId = null) {
  const filePath = getOpsFilePath(userId);
  const current = loadOpsSettings(userId);
  const next = {
    ...current,
    ...patch,
    autoApply: { ...current.autoApply, ...(patch.autoApply || {}) },
    notifications: { ...current.notifications, ...(patch.notifications || {}) },
    setupWizard: { ...current.setupWizard, ...(patch.setupWizard || {}) }
  };
  writeJson(filePath, next);
  return next;
}

export function loadScanResults() {
  return readJson(getScanResultsFile(), []);
}

export function normalizeJobKey(job = {}) {
  const company = String(job.company || job.company_name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const role = String(job.role || job.role_title || job.title || '')
    .toLowerCase()
    .replace(/\b(senior|sr|junior|jr|associate|lead)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return company && role ? `${company}__${role}` : '';
}

export function summarizeScraperHealth(scanResults = loadScanResults()) {
  const platforms = ['greenhouse', 'lever', 'naukri', 'internshala', 'wellfound', 'linkedin'];
  const now = Date.now();
  return platforms.map((platform) => {
    const rows = scanResults.filter((job) => String(job.source || '').toLowerCase().includes(platform));
    const newest = rows
      .map((job) => new Date(job.scanned_at || job.timestamp || job.posted || 0).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    const ageHours = newest ? Math.round((now - newest) / 36e5) : null;
    const errors = rows.filter((job) => job.status === 'error').length;
    let status = rows.length ? 'ok' : 'no_recent_data';
    if (errors && errors >= rows.length) status = 'error';
    if (ageHours != null && ageHours > 72) status = 'stale';
    return {
      platform,
      status,
      count: rows.length,
      errors,
      ageHours
    };
  });
}

export function deduplicateJobs(jobs = []) {
  const seen = new Map();
  const duplicates = [];
  for (const job of jobs) {
    const key = normalizeJobKey(job);
    if (!key) continue;
    if (seen.has(key)) {
      duplicates.push({ key, first: seen.get(key), duplicate: job });
    } else {
      seen.set(key, job);
    }
  }
  return { uniqueCount: seen.size, duplicateCount: duplicates.length, duplicates: duplicates.slice(0, 25) };
}
