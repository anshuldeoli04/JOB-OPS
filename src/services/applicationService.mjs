import { randomUUID } from "crypto";
import { canonicalizeUrl, jobKey, softKey, isSameJob } from "../../jobIdentity.mjs";
import { APPLICATIONS_FILE } from "../config/configPaths.mjs";
import {
  loadJsonFile,
  writeJsonFileAtomic,
  withFileLockSync,
} from "../utils/fileLock.mjs";
import {
  loadApplicationsFromDb,
  saveApplicationsToDb,
  upsertApplicationToDb,
} from "../storage/db.mjs";

export function buildApplicationKey(application) {
  return jobKey(application);
}

function addIdentity(identities, value, lowercase = false) {
  const normalized = String(value || "").trim();
  if (!normalized) return;
  identities.add(lowercase ? normalized.toLowerCase() : normalized);
}

export function buildApplicationIdentitySet(application = {}) {
  const identities = new Set();
  const rawUrl = application?.apply_url || application?.url || "";
  const canon = canonicalizeUrl(rawUrl);
  const composite = softKey(application?.company, application?.role, application?.location);

  addIdentity(identities, application.application_key, true);
  if (composite) addIdentity(identities, composite, true);
  if (canon) addIdentity(identities, `url:${canon}`, true);
  if (rawUrl) addIdentity(identities, `url:${rawUrl.trim().toLowerCase()}`, true);

  const legacyId = String(application?.id || "").trim();
  if (legacyId.startsWith("job:") || legacyId.startsWith("url:")) {
    addIdentity(identities, legacyId, true);
  }

  return identities;
}

export function applicationsMatch(left = {}, right = {}) {
  return isSameJob(left, right);
}

export function generateApplicationId() {
  return randomUUID();
}

export function loadApplications() {
  try {
    const dbApps = loadApplicationsFromDb();
    if (dbApps && dbApps.length > 0) return dbApps;
  } catch {}
  return loadJsonFile(APPLICATIONS_FILE, {
    fallback: [],
    warnMessage: "Warning: applications.json is corrupt or unreadable, starting fresh",
  });
}

export function saveApplications(applications = []) {
  writeJsonFileAtomic(APPLICATIONS_FILE, applications);
  try {
    saveApplicationsToDb(applications, false);
  } catch {}
}

export function upsertApplication(application = {}) {
  return withFileLockSync(APPLICATIONS_FILE, () => {
    const apps = loadApplications();
    const appWithKey = {
      ...application,
      application_key: application.application_key || buildApplicationKey(application),
    };
    const existingIndex = apps.findIndex((existing) => applicationsMatch(existing, appWithKey));
    if (existingIndex >= 0) {
      apps[existingIndex] = { ...apps[existingIndex], ...appWithKey };
    } else {
      apps.push(appWithKey);
    }
    writeJsonFileAtomic(APPLICATIONS_FILE, apps, { lock: false });
    try {
      upsertApplicationToDb(appWithKey, false);
    } catch {}
    return appWithKey;
  });
}
