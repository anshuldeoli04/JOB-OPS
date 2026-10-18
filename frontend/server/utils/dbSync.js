import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query, withTransaction } from './db.js';
import { getWorkspacePath } from './userWorkspace.js';

function jsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export async function importScanResultsToDb(userId, scanSessionId, scanResults) {
  for (const job of scanResults) {
    const companyRows = await query(
      `SELECT id FROM companies WHERE LOWER(name) = LOWER(:name) LIMIT 1`,
      { name: job.company || '' }
    );
    const duplicateRows = await query(
      `SELECT id FROM scanned_jobs WHERE job_url = :jobUrl LIMIT 1`,
      { jobUrl: job.url }
    );

    await query(
      `INSERT INTO scanned_jobs (
         scan_session_id, company_id, company_name, role_title, location, job_url,
         source, posted_at, is_evaluated, is_duplicate, raw_data, scraped_at
       ) VALUES (
         :scanSessionId, :companyId, :companyName, :roleTitle, :location, :jobUrl,
         :source, :postedAt, FALSE, :isDuplicate, :rawData, :scrapedAt
       )`,
      {
        scanSessionId,
        companyId: companyRows[0]?.id || null,
        companyName: job.company || 'Unknown',
        roleTitle: job.role || 'Unknown',
        location: job.location || null,
        jobUrl: job.url,
        source: job.source || 'manual',
        postedAt: job.posted ? new Date(job.posted) : null,
        isDuplicate: duplicateRows.length > 0,
        rawData: JSON.stringify(job),
        scrapedAt: job.scanned_at ? new Date(job.scanned_at) : new Date()
      }
    );
  }

  await query(
    `UPDATE scan_sessions
     SET total_found = :totalFound, new_found = :newFound
     WHERE id = :scanSessionId AND user_id = :userId`,
    {
      userId,
      scanSessionId,
      totalFound: scanResults.length,
      newFound: scanResults.filter((item) => item.url).length
    }
  );
}

export async function saveEvaluatedApplication(userId, result, options = {}) {
  const requestedId = options.applicationId || result.id || `app-${Date.now()}`;
  const jobUrl = options.jobUrl || result.url || result.apply_url || options.selectedScanUrl || `manual://${requestedId}`;
  const scannedJobId = options.scannedJobId || null;
  const existingRows = await query(
    `SELECT id FROM applications WHERE user_id = :userId AND job_url = :jobUrl LIMIT 1`,
    { userId, jobUrl }
  );
  const applicationId = existingRows[0]?.id || requestedId;

  await withTransaction(async (connection) => {
    const [companyRows] = await connection.execute(
      `SELECT id FROM companies WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [result.company || '']
    );
    const [levelRows] = await connection.execute(
      `SELECT id FROM experience_levels WHERE slug = ? LIMIT 1`,
      [options.experienceLevel || 'fresher']
    );

    await connection.execute(
      `INSERT INTO applications (
         id, user_id, scanned_job_id, company_id, company_name, role_title, location, job_url,
         job_description, source, ai_score, ai_grade, verdict, fit_summary, negotiation_note,
         salary_estimate, status, experience_level_id, evaluated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'evaluated', ?, NOW())
       ON CONFLICT (id) DO UPDATE SET
         company_id = EXCLUDED.company_id,
         company_name = EXCLUDED.company_name,
         role_title = EXCLUDED.role_title,
         location = EXCLUDED.location,
         job_url = EXCLUDED.job_url,
         job_description = EXCLUDED.job_description,
         source = EXCLUDED.source,
         ai_score = EXCLUDED.ai_score,
         ai_grade = EXCLUDED.ai_grade,
         verdict = EXCLUDED.verdict,
         fit_summary = EXCLUDED.fit_summary,
         negotiation_note = EXCLUDED.negotiation_note,
         salary_estimate = EXCLUDED.salary_estimate,
         status = EXCLUDED.status,
         experience_level_id = EXCLUDED.experience_level_id,
         updated_at = CURRENT_TIMESTAMP`,
      [
        applicationId,
        userId,
        scannedJobId,
        companyRows[0]?.id || null,
        result.company || 'Unknown',
        result.role || 'Unknown',
        result.location || 'Remote',
        jobUrl,
        options.jobDescription || null,
        options.source || 'manual',
        result.score,
        result.grade,
        result.verdict,
        result.fit_summary || '',
        result.negotiation_note || '',
        result.salary_estimate || '',
        levelRows[0]?.id || null
      ]
    );

    const detailTables = [
      ['application_strengths', 'strength', result.strengths || []],
      ['application_gaps', 'gap', result.gaps || []],
      ['application_interview_prep', 'question', result.interview_prep || []],
      ['application_action_items', 'action_item', result.action_items || []]
    ];

    for (const [table] of detailTables) {
      await connection.execute(`DELETE FROM ${table} WHERE application_id = ?`, [applicationId]);
    }

    for (const [index, value] of (result.strengths || []).entries()) {
      await connection.execute(
        `INSERT INTO application_strengths (application_id, strength, sort_order) VALUES (?, ?, ?)`,
        [applicationId, value, index]
      );
    }
    for (const [index, value] of (result.gaps || []).entries()) {
      await connection.execute(
        `INSERT INTO application_gaps (application_id, gap, sort_order) VALUES (?, ?, ?)`,
        [applicationId, value, index]
      );
    }
    for (const [index, value] of (result.interview_prep || []).entries()) {
      await connection.execute(
        `INSERT INTO application_interview_prep (application_id, question, sort_order) VALUES (?, ?, ?)`,
        [applicationId, value, index]
      );
    }
    for (const [index, value] of (result.action_items || []).entries()) {
      await connection.execute(
        `INSERT INTO application_action_items (application_id, action_item, sort_order) VALUES (?, ?, ?)`,
        [applicationId, value, index]
      );
    }

    await connection.execute(
      `INSERT INTO activity_log (user_id, event_type, entity_type, entity_id, meta)
       VALUES (?, 'job_evaluated', 'application', ?, jsonb_build_object('company', ?::text, 'role', ?::text, 'score', ?::numeric, 'grade', ?::text))`,
      [userId, applicationId, result.company || 'Unknown', result.role || 'Unknown', result.score || 0, result.grade || 'C']
    );
  });

  return applicationId;
}

export async function syncResumeRecord(userId, applicationId, resumeHtmlPath, resumePdfPath) {
  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE resumes SET is_current = FALSE WHERE application_id = ? AND is_current = TRUE`,
      [applicationId]
    );

    const [versionRows] = await connection.execute(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM resumes WHERE application_id = ?`,
      [applicationId]
    );

    await connection.execute(
      `INSERT INTO resumes (
         application_id, user_id, version, html_path, pdf_path, is_current, generated_at
       ) VALUES (?, ?, ?, ?, ?, TRUE, NOW())`,
      [applicationId, userId, versionRows[0].next_version, resumeHtmlPath || null, resumePdfPath || null]
    );
  });
}

export async function buildApplicationsResponseRows(userId) {
  const rows = await query(
    `SELECT
       a.id,
       a.company_name,
       a.role_title,
       a.location,
       a.salary_estimate,
       a.ai_score,
       a.ai_grade,
       a.verdict,
       a.fit_summary,
       a.negotiation_note,
       a.status,
       a.source,
       a.job_url,
       a.evaluated_at,
       a.required_exp_min,
       a.required_exp_max,
       el.slug AS experience_level,
       r.pdf_path AS resume_pdf,
       r.html_path AS resume_html,
       COALESCE((SELECT json_agg(strength) FROM application_strengths WHERE application_id = a.id), json_build_array()) AS strengths,
       COALESCE((SELECT json_agg(gap) FROM application_gaps WHERE application_id = a.id), json_build_array()) AS gaps,
       COALESCE((SELECT json_agg(question) FROM application_interview_prep WHERE application_id = a.id), json_build_array()) AS interview_prep,
       COALESCE((SELECT json_agg(action_item) FROM application_action_items WHERE application_id = a.id), json_build_array()) AS action_items
     FROM applications a
     LEFT JOIN experience_levels el ON el.id = a.experience_level_id
     LEFT JOIN resumes r ON r.application_id = a.id AND r.is_current = TRUE
     WHERE a.user_id = $1
     ORDER BY a.evaluated_at DESC`,
    [userId]
  );

  return rows.map((row) => ({
    ...row,
    strengths: jsonArray(row.strengths),
    gaps: jsonArray(row.gaps),
    interview_prep: jsonArray(row.interview_prep),
    action_items: jsonArray(row.action_items)
  }));
}

export async function writeEvaluationReport(result, userId = null, applicationId = null) {
  const reportDir = getWorkspacePath('reports');
  await mkdir(reportDir, { recursive: true });
  const slug = String(result.company || 'company').replace(/[^a-z0-9]+/gi, '_');
  const userPrefix = userId ? `u${userId}_` : '';
  const appPrefix = applicationId ? `${applicationId}_` : '';
  const filePath = path.join(reportDir, `${userPrefix}${appPrefix}${slug}.md`);
  const content = `# ${result.company} - ${result.role}
Score: ${result.score}/10 (${result.grade})
Verdict: ${result.verdict}
Location: ${result.location}
Salary Estimate: ${result.salary_estimate}

## Fit Summary
${result.fit_summary}

## Strengths
${(result.strengths || []).map((item) => `- ${item}`).join('\n')}

## Gaps
${(result.gaps || []).map((item) => `- ${item}`).join('\n')}

## Interview Prep
${(result.interview_prep || []).map((item, index) => `${index + 1}. ${item}`).join('\n')}

## Action Items
${(result.action_items || []).map((item, index) => `${index + 1}. ${item}`).join('\n')}
`;
  await writeFile(filePath, content, 'utf8');
  return filePath;
}
