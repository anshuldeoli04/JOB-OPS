import express from 'express';
import { requireCurrentUserId } from '../utils/currentUser.js';
import { exportUserWorkspaceFiles, syncApplicationsToWorkspace, readWorkspaceJsonFile } from '../utils/userWorkspace.js';
import { runNodeScript } from '../utils/processRunner.js';
import { syncResumeRecord } from '../utils/dbSync.js';
import { toPublicFileUrl } from '../utils/fileLinks.js';
import { emitStreamEvent, subscribeStream } from '../utils/sseHub.js';
import { withWorkspaceLock } from '../utils/workspaceLock.js';

const router = express.Router();

router.get('/stream', async (req, res) => {
  try {
    const userId = await requireCurrentUserId(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'status', status: 'idle' })}\n\n`);
    const unsubscribe = subscribeStream('resume', res, req, userId);
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
    const { jobId } = req.body || {};
    if (!jobId) {
      emitStreamEvent('resume', { type: 'error', message: 'jobId is required for resume generation.' }, userId);
      return res.status(400).json({ error: 'jobId is required for resume generation.' });
    }

    emitStreamEvent('resume', { type: 'status', status: 'running' }, userId);
    emitStreamEvent('resume', { type: 'log', message: 'Exporting user workspace files...' }, userId);
    await exportUserWorkspaceFiles(userId);
    emitStreamEvent('resume', { type: 'log', message: 'Syncing applications into the workspace...' }, userId);
    await syncApplicationsToWorkspace(userId);

    const { logs } = await runNodeScript('resume-builder.mjs', [`--job-id=${jobId}`], {
      onLog(line) {
        emitStreamEvent('resume', { type: 'log', message: line }, userId);
      }
    });
    emitStreamEvent('resume', { type: 'log', message: 'Reading generated resume files...' }, userId);
    const applications = await readWorkspaceJsonFile('data/applications.json', []);
    const matched = applications.find((item) => item.id === jobId);

    await syncResumeRecord(userId, jobId, matched?.resume_html || null, matched?.resume_pdf || null);

    const response = {
      ok: true,
      message: matched?.resume_html
        ? 'Resume generated and linked successfully.'
        : 'Resume script ran, but only partial output was captured.',
      resume_pdf: toPublicFileUrl(matched?.resume_pdf || null),
      resume_html: toPublicFileUrl(matched?.resume_html || null),
      logs
    };
    emitStreamEvent('resume', { type: 'complete', result: response }, userId);
    res.json(response);
    });
  } catch (error) {
    if (userId) {
      emitStreamEvent('resume', { type: 'error', message: error.message || 'Resume generation failed.' }, userId);
    }
    next(error);
  }
});

export default router;
