import express from 'express';
import { query } from '../utils/db.js';
import { requireCurrentUserId } from '../utils/currentUser.js';
import { mapApplicationRow } from '../utils/sqlMappers.js';

const router = express.Router();

const applicationSelect = `
  SELECT
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
    COALESCE((
      SELECT json_agg(s.strength)
      FROM application_strengths s
      WHERE s.application_id = a.id
    ), json_build_array()) AS strengths,
    COALESCE((
      SELECT json_agg(g.gap)
      FROM application_gaps g
      WHERE g.application_id = a.id
    ), json_build_array()) AS gaps,
    COALESCE((
      SELECT json_agg(p.question)
      FROM application_interview_prep p
      WHERE p.application_id = a.id
    ), json_build_array()) AS interview_prep,
    COALESCE((
      SELECT json_agg(ai.action_item)
      FROM application_action_items ai
      WHERE ai.application_id = a.id
    ), json_build_array()) AS action_items
  FROM applications a
  LEFT JOIN experience_levels el ON el.id = a.experience_level_id
  LEFT JOIN resumes r ON r.application_id = a.id AND r.is_current = TRUE
  WHERE a.user_id = $1
  ORDER BY a.evaluated_at DESC
`;

router.get('/', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const paginatedSql = `${applicationSelect} LIMIT $2 OFFSET $3`;
    const rows = await query(paginatedSql, [userId, limit, offset]);

    res.setHeader('X-Total-Limit', String(limit));
    res.setHeader('X-Total-Offset', String(offset));
    res.json(rows.map(mapApplicationRow));
  } catch (error) {
    next(error);
  }
});

const ALLOWED_STATUSES = new Set(['evaluated', 'applied', 'interview', 'offer', 'rejected', 'withdrawn']);

router.patch('/:id', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const { id } = req.params;
    const { status } = req.body || {};
    if (!status || !ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid application status. Allowed: ${Array.from(ALLOWED_STATUSES).join(', ')}` });
    }
    await query(
      `UPDATE applications
       SET status = $1
       WHERE id = $2 AND user_id = $3`,
      [status, id, userId]
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.patch('/', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const { ids = [], status = 'evaluated' } = req.body || {};
    if (!status || !ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid application status. Allowed: ${Array.from(ALLOWED_STATUSES).join(', ')}` });
    }

    if (!Array.isArray(ids) || !ids.length) {
      return res.json({ applications: [] });
    }

    await query(
      `UPDATE applications
       SET status = $1
       WHERE user_id = $2 AND id = ANY($3::text[])`,
      [status, userId, ids]
    );

    const rows = await query(applicationSelect, [userId]);
    res.json({ applications: rows.map(mapApplicationRow) });
  } catch (error) {
    next(error);
  }
});

export default router;
