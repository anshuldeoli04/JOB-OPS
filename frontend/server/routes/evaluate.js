import express from 'express';
import { requireCurrentUserId } from '../utils/currentUser.js';
import { exportUserWorkspaceFiles } from '../utils/userWorkspace.js';
import { saveEvaluatedApplication, buildApplicationsResponseRows, writeEvaluationReport } from '../utils/dbSync.js';
import { mapApplicationRow } from '../utils/sqlMappers.js';
import { query } from '../utils/db.js';
import { emitStreamEvent, subscribeStream } from '../utils/sseHub.js';
import { withWorkspaceLock } from '../utils/workspaceLock.js';
import { validateEvaluation } from '../../../config-utils.mjs';
import { callLLM } from '../../../llm/llmClient.mjs';
import { buildDeepEvaluationPrompt } from '../../../llm/evalPrompt.mjs';
import { safeJsonParse } from '../../../llm/jsonUtils.mjs';

const router = express.Router();

router.get('/stream', async (req, res) => {
  try {
    const userId = await requireCurrentUserId(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'status', status: 'idle' })}\n\n`);
    const unsubscribe = subscribeStream('evaluate', res, req, userId);
    req.on('close', unsubscribe);
    res.on('close', unsubscribe);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

router.post('/', async (req, res, next) => {
  let userId = null;
  try {
    userId = await requireCurrentUserId(req);
    await withWorkspaceLock(userId, async () => {
    const body = req.body || {};
    emitStreamEvent('evaluate', { type: 'status', status: 'running' }, userId);
    emitStreamEvent('evaluate', { type: 'log', message: 'Preparing workspace files...' }, userId);
    const bundle = await exportUserWorkspaceFiles(userId);
    const experienceProfile = {
      years: bundle.config.experience_years || 0,
      level: bundle.config.experience_level || 'fresher'
    };

    let jobDescription = body.jd || '';
    let source = 'manual';
    let selectedScanRow = null;

    if (!jobDescription && body.selectedScanUrl) {
      const rows = await query(
        `SELECT id, source, raw_data
         FROM scanned_jobs
         WHERE job_url = :jobUrl
         ORDER BY id DESC
         LIMIT 1`,
        { jobUrl: body.selectedScanUrl }
      );
      selectedScanRow = rows[0] || null;
      source = selectedScanRow?.source || 'manual';
      const rawData = selectedScanRow?.raw_data;
      let raw = {};
      if (typeof rawData === 'object' && rawData !== null) {
        raw = rawData;
      } else if (typeof rawData === 'string' && rawData.trim()) {
        try {
          raw = JSON.parse(rawData);
        } catch {
          raw = {};
        }
      }
      jobDescription =
        raw.content ||
        raw.description ||
        (Object.keys(raw).length ? JSON.stringify(raw, null, 2) : '') ||
        `Company: ${body.scanItem?.company}\nRole: ${body.scanItem?.role}\nLocation: ${body.scanItem?.location}\nURL: ${body.selectedScanUrl}`;
    }

    if (!jobDescription && body.url) {
      jobDescription = `Job URL: ${body.url}\nPlease evaluate based on this linked role context.`;
      source = 'manual';
    }

    if (!jobDescription || jobDescription.trim().length < 50) {
      return res.status(400).json({ error: 'Please provide a full job description or pick a scanned job with enough content.' });
    }
    if (jobDescription.length > 50000) {
      return res.status(400).json({ error: 'Job description too large. Keep it under 50KB.' });
    }

    if (!bundle.config.gemini_api_key) {
      emitStreamEvent('evaluate', { type: 'error', message: 'Gemini API key missing. Save it in Settings first.' }, userId);
      return res.status(400).json({ error: 'Gemini API key missing. Save it in Settings first.' });
    }

    emitStreamEvent('evaluate', {
      type: 'log',
      message: 'Calling LLM client (Gemini primary)...'
    }, userId);
    const response = await callLLM('score_job', [{ role: 'user', content: buildDeepEvaluationPrompt(jobDescription, bundle.cvContent, experienceProfile) }], {
      config: bundle.config,
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseFormat: { type: 'json_object' },
      allowGroqFallback: false
    });
    emitStreamEvent('evaluate', { type: 'log', message: 'LLM response received. Validating JSON...' }, userId);
    const rawText = response?.text || String(response);
    const result = validateEvaluation(safeJsonParse(rawText), {
      provider: response?.provider,
      model: response?.model,
      evaluated_by: response?.provider ? `${response.provider}/${response.model}` : 'gemini',
    });

    const applicationId = `app-${Date.now()}`;
    emitStreamEvent('evaluate', { type: 'log', message: 'Saving evaluation to workspace and database...' }, userId);
    const savedId = await saveEvaluatedApplication(userId, result, {
      applicationId,
      selectedScanUrl: body.selectedScanUrl,
      source,
      scannedJobId: selectedScanRow?.id || null,
      jobDescription,
      experienceLevel: bundle.config.experience_level
    });
    await writeEvaluationReport(result, userId, savedId);

    const applications = await buildApplicationsResponseRows(userId);
    const created = applications.find((item) => item.id === savedId);
    const mappedResult = mapApplicationRow(created);
    emitStreamEvent('evaluate', { type: 'log', message: 'Evaluation complete. Returning result...' }, userId);
    emitStreamEvent('evaluate', { type: 'complete', result: mappedResult }, userId);
    res.json({ result: mappedResult });
    });
  } catch (error) {
    if (userId) {
      emitStreamEvent('evaluate', { type: 'error', message: error.message || 'Evaluation failed.' }, userId);
    }
    next(error);
  }
});

export default router;
