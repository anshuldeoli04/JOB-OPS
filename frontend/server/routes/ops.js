import express from 'express';
import { query } from '../utils/db.js';
import { requireCurrentUserId } from '../utils/currentUser.js';
import { mapApplicationRow } from '../utils/sqlMappers.js';
import {
  deduplicateJobs,
  loadOpsSettings,
  loadScanResults,
  roadmapPhases,
  saveOpsSettings,
  summarizeScraperHealth
} from '../utils/opsStore.js';

const router = express.Router();

const platformMatchers = {
  greenhouse: /greenhouse\.io|greenhouse/i,
  lever: /jobs\.lever\.co|lever/i,
  internshala: /internshala/i
};

function detectPlatform(url = '', source = '') {
  const haystack = `${url} ${source}`;
  return Object.entries(platformMatchers).find(([, pattern]) => pattern.test(haystack))?.[0] || 'unsupported';
}

function buildSelectorPlan(platform) {
  if (platform === 'greenhouse') {
    return {
      firstName: 'input#first_name, input[name="job_application[first_name]"]',
      lastName: 'input#last_name, input[name="job_application[last_name]"]',
      email: 'input#email, input[name="job_application[email]"]',
      phone: 'input#phone, input[name="job_application[phone]"]',
      resume: 'input#resume, input[type="file"][name*="resume"]',
      submit: 'input[type="submit"], button[type="submit"]'
    };
  }
  if (platform === 'lever') {
    return {
      name: 'input[name="name"]',
      email: 'input[name="email"]',
      phone: 'input[name="phone"]',
      resume: 'input[type="file"]',
      submit: 'button[type="submit"]'
    };
  }
  return {};
}

async function loadApplications(userId) {
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
     ORDER BY a.evaluated_at DESC`,
    [userId]
  );
  return rows.map(mapApplicationRow);
}

router.get('/', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const scanResults = loadScanResults();
    res.json({
      settings: loadOpsSettings(userId),
      phases: roadmapPhases,
      health: summarizeScraperHealth(scanResults),
      dedup: deduplicateJobs(scanResults)
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/settings', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    res.json({ settings: saveOpsSettings(req.body || {}, userId) });
  } catch (error) {
    next(error);
  }
});

router.get('/health', async (req, res, next) => {
  try {
    await requireCurrentUserId(req);
    const scanResults = loadScanResults();
    res.json({
      health: summarizeScraperHealth(scanResults),
      dedup: deduplicateJobs(scanResults)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auto-apply/preview', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const settings = loadOpsSettings(userId);
    const minScore = Number(req.body?.minScore ?? settings.autoApply.minScore ?? 7);
    const applications = await loadApplications(userId);
    const candidates = applications
      .filter((item) => ['evaluated', 'ready', 'shortlisted'].includes(item.status || 'evaluated'))
      .filter((item) => Number(item.score || 0) >= minScore)
      .map((item) => {
        const platform = detectPlatform(item.apply_url || item.url, item.source);
        return {
          id: item.id,
          company: item.company,
          role: item.role,
          score: item.score,
          platform,
          supported: settings.autoApply.platforms.includes(platform),
          safeSubmitOnly: true,
          url: item.apply_url || item.url,
          resumeReady: Boolean(item.resume_pdf),
          selectorPlan: buildSelectorPlan(platform)
        };
      });

    res.json({
      mode: 'safe-preview',
      message: 'Forms can be prepared, but final submit remains manual confirmation only.',
      candidates
    });
  } catch (error) {
    next(error);
  }
});

router.get('/score-report/:id', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const app = (await loadApplications(userId)).find((item) => item.id === req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found.' });
    const score100 = Math.round(Number(app.score || 0) * 10);
    res.json({
      applicationId: app.id,
      company: app.company,
      role: app.role,
      overall_score: score100,
      grade: app.grade,
      recommendation: score100 >= 80 ? 'apply' : score100 >= 65 ? 'apply_tailored' : 'skip',
      matched_skills: app.strengths || [],
      missing_skills: app.gaps || [],
      one_line_reason: app.fit_summary || app.verdict || 'Review manually before applying.'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
