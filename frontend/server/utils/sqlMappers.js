import { toPublicFileUrl } from './fileLinks.js';

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    experienceLevel: row.experience_level || 'fresher',
    experienceYears: row.experience_years ?? 0,
    targetRole: row.primary_target_role || ''
  };
}

export function mapApplicationRow(row) {
  return {
    id: row.id,
    timestamp: row.evaluated_at,
    company: row.company_name,
    role: row.role_title,
    location: row.location,
    salary_estimate: row.salary_estimate,
    score: row.ai_score == null ? null : Number(row.ai_score),
    grade: row.ai_grade,
    verdict: row.verdict,
    fit_summary: row.fit_summary,
    strengths: safeJsonParse(row.strengths, []),
    gaps: safeJsonParse(row.gaps, []),
    interview_prep: safeJsonParse(row.interview_prep, []),
    action_items: safeJsonParse(row.action_items, []),
    negotiation_note: row.negotiation_note,
    status: row.status,
    source: row.source,
    url: row.job_url,
    apply_url: row.job_url,
    resume_pdf: toPublicFileUrl(row.resume_pdf),
    resume_html: toPublicFileUrl(row.resume_html),
    experience_level: row.experience_level,
    required_exp_min: row.required_exp_min,
    required_exp_max: row.required_exp_max
  };
}

export function mapScanRow(row) {
  return {
    id: row.id,
    source: row.source,
    company: row.company_name,
    role: row.role_title,
    location: row.location,
    url: row.job_url,
    posted: row.posted_at,
    scanned_at: row.scraped_at,
    status: row.is_evaluated ? 'evaluated' : 'scanned'
  };
}

export function mapActivityRow(row) {
  const meta = safeJsonParse(row.meta, {});
  return {
    id: row.id,
    title: meta.company ? `${row.event_type}: ${meta.company}` : row.event_type,
    description: meta.role || meta.new_status || row.entity_type || 'Activity logged',
    timestamp: row.created_at
  };
}
