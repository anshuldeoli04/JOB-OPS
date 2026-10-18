import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';
import { decryptSecret } from './secrets.js';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));

function normalizeExperienceYears(levelSlug) {
  if (levelSlug === 'fresher') return 0;
  if (levelSlug === '0-1yr') return 1;
  if (levelSlug === '1-3yr') return 3;
  if (levelSlug === '3+yr') return 4;
  return 0;
}

export function getWorkspacePath(...segments) {
  return path.join(workspaceRoot, ...segments);
}

export async function getUserProfileBundle(userId) {
  const [users, roles, locations, cvs] = await Promise.all([
    query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.gemini_api_key,
         u.gemini_model,
         u.expected_ctc_min,
         u.expected_ctc_max,
         el.slug AS experience_level
       FROM users u
       LEFT JOIN experience_levels el ON el.id = u.experience_level_id
       WHERE u.id = :userId
       LIMIT 1`,
      { userId }
    ),
    query(
      `SELECT role_name
       FROM user_target_roles
       WHERE user_id = :userId AND is_active = TRUE
       ORDER BY id ASC`,
      { userId }
    ),
    query(
      `SELECT location_name
       FROM user_target_locations
       WHERE user_id = :userId AND is_active = TRUE
       ORDER BY id ASC`,
      { userId }
    ),
    query(
      `SELECT content_md
       FROM user_cvs
       WHERE user_id = :userId AND is_current = TRUE
       ORDER BY id DESC
       LIMIT 1`,
      { userId }
    )
  ]);

  const user = users[0];
  if (!user) return null;

  return {
    user,
    config: {
      gemini_api_key: decryptSecret(user.gemini_api_key || ''),
      gemini_model: user.gemini_model || 'gemini-2.5-flash',
      name: user.name || '',
      target_roles: roles.map((item) => item.role_name),
      target_locations: locations.map((item) => item.location_name),
      experience_years: normalizeExperienceYears(user.experience_level),
      experience_level: user.experience_level || 'fresher',
      expected_ctc_lpa:
        user.expected_ctc_min != null && user.expected_ctc_max != null
          ? `${user.expected_ctc_min}-${user.expected_ctc_max}`
          : ''
    },
    cvContent: cvs[0]?.content_md || ''
  };
}

export async function exportUserWorkspaceFiles(userId) {
  const bundle = await getUserProfileBundle(userId);
  if (!bundle) {
    throw new Error('User profile not found.');
  }

  const { gemini_api_key: geminiApiKey, ...configWithoutSecret } = bundle.config;

  await writeFile(
    getWorkspacePath('config.local.json'),
    JSON.stringify(configWithoutSecret, null, 2),
    'utf8'
  );
  await writeWorkspaceEnvFile({
    GEMINI_API_KEY: geminiApiKey,
    GEMINI_MODEL: bundle.config.gemini_model || 'gemini-2.5-flash'
  });

  if (!bundle.cvContent || bundle.cvContent.trim().length < 30) {
    throw new Error('Resume/CV missing. Please add your CV text in Settings first.');
  }

  await writeFile(getWorkspacePath('cv.md'), bundle.cvContent, 'utf8');
  return bundle;
}

async function writeWorkspaceEnvFile(updates = {}) {
  const cleanUpdates = {};
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      cleanUpdates[key] = String(val).trim();
    }
  }
  if (Object.keys(cleanUpdates).length === 0) return;

  const envPath = getWorkspacePath('.env');
  let lines = [];

  try {
    lines = (await readFile(envPath, 'utf8')).split(/\r?\n/);
  } catch {}

  const updateKeys = new Set(Object.keys(cleanUpdates));
  const retainedLines = lines.filter((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return !match || !updateKeys.has(match[1]);
  });

  for (const [key, value] of Object.entries(cleanUpdates)) {
    retainedLines.push(`${key}=${value}`);
  }

  await writeFile(envPath, `${retainedLines.filter(Boolean).join('\n')}\n`, 'utf8');
}

export async function readWorkspaceJsonFile(relativePath, fallbackValue = []) {
  try {
    const raw = await readFile(getWorkspacePath(relativePath), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

export async function writeWorkspaceJsonFile(relativePath, value) {
  const target = getWorkspacePath(relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2), 'utf8');
}

export async function syncApplicationsToWorkspace(userId) {
  const rows = await query(
    `SELECT
       a.id,
       a.evaluated_at AS timestamp,
       a.company_name AS company,
       a.role_title AS role,
       a.location,
       a.salary_estimate,
       a.ai_score AS score,
       a.ai_grade AS grade,
       a.verdict,
       a.fit_summary,
       a.negotiation_note,
       a.status,
       a.job_url AS url,
       a.job_url AS apply_url,
       r.pdf_path AS resume_pdf,
       r.html_path AS resume_html,
       COALESCE((SELECT json_agg(strength) FROM application_strengths WHERE application_id = a.id), json_build_array()) AS strengths,
       COALESCE((SELECT json_agg(gap) FROM application_gaps WHERE application_id = a.id), json_build_array()) AS gaps,
       COALESCE((SELECT json_agg(question) FROM application_interview_prep WHERE application_id = a.id), json_build_array()) AS interview_prep,
       COALESCE((SELECT json_agg(action_item) FROM application_action_items WHERE application_id = a.id), json_build_array()) AS action_items
     FROM applications a
     LEFT JOIN resumes r ON r.application_id = a.id AND r.is_current = TRUE
     WHERE a.user_id = $1
     ORDER BY a.evaluated_at DESC`,
    [userId]
  );

  const normalized = rows.map((row) => ({
    ...row,
    score: row.score == null ? null : Number(row.score),
    strengths: Array.isArray(row.strengths) ? row.strengths : JSON.parse(row.strengths || '[]'),
    gaps: Array.isArray(row.gaps) ? row.gaps : JSON.parse(row.gaps || '[]'),
    interview_prep: Array.isArray(row.interview_prep) ? row.interview_prep : JSON.parse(row.interview_prep || '[]'),
    action_items: Array.isArray(row.action_items) ? row.action_items : JSON.parse(row.action_items || '[]')
  }));

  const existingApps = await readWorkspaceJsonFile('data/applications.json', []);
  const mergedMap = new Map();
  for (const app of existingApps) {
    if (app && app.id) {
      mergedMap.set(String(app.id), app);
    }
  }
  for (const dbApp of normalized) {
    const existing = mergedMap.get(String(dbApp.id));
    mergedMap.set(String(dbApp.id), {
      ...existing,
      ...dbApp
    });
  }

  const mergedList = Array.from(mergedMap.values());
  await writeWorkspaceJsonFile(path.join('data', 'applications.json'), mergedList);
  return mergedList;
}
