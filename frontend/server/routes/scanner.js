import express from 'express';
import { readJson, writeJson, ensureJsonFile } from '../utils/fileDb.js';
import { query } from '../utils/db.js';
import { requireCurrentUserId } from '../utils/currentUser.js';
import { mapScanRow } from '../utils/sqlMappers.js';
import { exportUserWorkspaceFiles, readWorkspaceJsonFile } from '../utils/userWorkspace.js';
import { runNodeScript } from '../utils/processRunner.js';
import { importScanResultsToDb, saveEvaluatedApplication } from '../utils/dbSync.js';
import { emitScannerEvent, subscribeScannerStream } from '../utils/sseHub.js';
import { withWorkspaceLock } from '../utils/workspaceLock.js';

const router = express.Router();
const allowedSources = new Set(['greenhouse', 'lever', 'internshala', 'naukri', 'wellfound']);

function getScanStreamFile(userId) {
  const safeId = String(userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return new URL(`../data/scan-stream-${safeId}.json`, import.meta.url);
}

router.get('/', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const rows = await query(
      `SELECT
         sj.id,
         sj.source,
         sj.company_name,
         sj.role_title,
         sj.location,
         sj.job_url,
         sj.posted_at,
         sj.scraped_at,
         sj.is_evaluated
       FROM scanned_jobs sj
       INNER JOIN scan_sessions ss ON ss.id = sj.scan_session_id
       WHERE ss.user_id = :userId
       ORDER BY sj.scraped_at DESC
       LIMIT 200`,
      { userId }
    );
    res.json(rows.map(mapScanRow));
  } catch (error) {
    next(error);
  }
});

router.get('/stream', async (req, res) => {
  try {
    const userId = await requireCurrentUserId(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const streamFile = getScanStreamFile(userId);
    const current = await readJson(streamFile, { logs: [] });
    current.logs.forEach((message) => {
      res.write(`data: ${JSON.stringify({ type: 'log', message })}\n\n`);
    });
    const unsubscribe = subscribeScannerStream(res, req, userId);
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
    const { mode = 'scan', sources = [], keywords = '' } = req.body || {};
    const normalizedSources = (Array.isArray(sources) ? sources : [])
      .map((source) => String(source || '').trim().toLowerCase())
      .filter(Boolean);
    const invalidSources = normalizedSources.filter((source) => !allowedSources.has(source));

    if (invalidSources.length) {
      return res.status(400).json({ error: `Unsupported scan source: ${invalidSources.join(', ')}` });
    }

    const normalizedKeywords = String(keywords || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join(',');

    await exportUserWorkspaceFiles(userId);
    const beforeResults = await readWorkspaceJsonFile('data/scan-results.json', []);
    const beforeUrls = new Set(beforeResults.map((item) => item.url).filter(Boolean));

    const sessionResult = await query(
      `INSERT INTO scan_sessions (user_id, status, sources_used, keywords_used, total_found, new_found, started_at)
       VALUES (:userId, 'running', :sourcesUsed, :keywordsUsed, 0, 0, NOW())`,
      {
        userId,
        sourcesUsed: JSON.stringify(normalizedSources),
        keywordsUsed: JSON.stringify(
          normalizedKeywords
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        )
      }
    );
    const scanSessionId = sessionResult.insertId;

    const isAutoflow = mode === 'autoflow';
    const scriptToRun = isAutoflow ? 'autoflow.mjs' : 'scanner.mjs';
    const cleanKeywords = normalizedKeywords
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .join(',');

    const args = [
      scriptToRun,
      ...(normalizedSources.length ? [`--sources=${normalizedSources.join(',')}`] : []),
      ...(cleanKeywords ? [`--keywords=${cleanKeywords}`] : []),
      '--non-interactive',
      ...(isAutoflow ? ['--headless', '--yes'] : ['--skip-evaluate-prompt'])
    ];

    const streamFile = getScanStreamFile(userId);
    await writeJson(streamFile, { logs: [] });
    emitScannerEvent({ type: 'status', status: 'running' }, userId);

    const { logs } = await runNodeScript(args[0], args.slice(1), {
      onLog(line) {
        emitScannerEvent({ type: 'log', message: line }, userId);
      }
    });
    await writeJson(streamFile, { logs });

    const scanResults = await readWorkspaceJsonFile('data/scan-results.json', []);
    const filtered = scanResults.filter((item) => {
      if (!item.url || beforeUrls.has(item.url)) return false;
      if (!normalizedSources.length) return true;
      return normalizedSources.includes(item.source);
    });
    emitScannerEvent({ type: 'complete', total: filtered.length, new: filtered.length }, userId);

    await importScanResultsToDb(userId, scanSessionId, filtered);

    if (isAutoflow) {
      const workspaceApps = await readWorkspaceJsonFile('data/applications.json', []);
      for (const app of workspaceApps) {
        try {
          await saveEvaluatedApplication(userId, app, {
            applicationId: app.id,
            jobUrl: app.apply_url || app.url,
            source: app.source || 'autoflow',
            experienceLevel: 'fresher'
          });
        } catch {}
      }
    }

    await query(
      `UPDATE scan_sessions
       SET status = 'completed', completed_at = NOW()
       WHERE id = :scanSessionId`,
      { scanSessionId }
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, entity_type, entity_id, meta)
       VALUES (
         $1,
         $2,
         'scan_session',
         $3,
         jsonb_build_object('mode', $4::text, 'sources', $5::text, 'results', $6::int)
       )`,
      [
        userId,
        mode === 'autoflow' ? 'autoflow_completed' : 'scan_completed',
        String(scanSessionId),
        mode,
        normalizedSources.join(','),
        filtered.length
      ]
    );

    const rows = await query(
      `SELECT
         sj.id,
         sj.source,
         sj.company_name,
         sj.role_title,
         sj.location,
         sj.job_url,
         sj.posted_at,
         sj.scraped_at,
         sj.is_evaluated
       FROM scanned_jobs sj
       INNER JOIN scan_sessions ss ON ss.id = sj.scan_session_id
       WHERE ss.user_id = :userId
       ORDER BY sj.scraped_at DESC
       LIMIT 200`,
      { userId }
    );

    res.json({
      ok: true,
      message: `Scanner completed. ${filtered.length} matching jobs synced from the CLI pipeline.`,
      scanResults: rows.map(mapScanRow),
      logs
    });
    });
  } catch (error) {
    if (userId) {
      const streamFile = getScanStreamFile(userId);
      await writeJson(streamFile, { logs: error.logs || [error.message] });
      emitScannerEvent({ type: 'error', message: error.message }, userId);
    }
    next(error);
  }
});

export default router;
