import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import applicationsRouter from './routes/applications.js';
import configRouter from './routes/config.js';
import scannerRouter from './routes/scanner.js';
import evaluateRouter from './routes/evaluate.js';
import resumeRouter from './routes/resume.js';
import activityRouter from './routes/activity.js';
import usageRouter from './routes/usage.js';
import opsRouter from './routes/ops.js';
import { loadLocalEnv } from './utils/loadEnv.js';
import { query } from './utils/db.js';
import { requireCurrentUserId } from './utils/currentUser.js';

loadLocalEnv();

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(helmet());

const port = process.env.PORT || 3001;
const host = process.env.HOST || '127.0.0.1';
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin not allowed.'));
    }
  })
);

// Global lighter rate limit
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});
app.use(globalLimiter);

// Auth strict rate limit: 10 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' }
});

// JSON body limits: 2MB scoped for CV/markdown endpoints, 100KB general default
app.use('/api/config', express.json({ limit: '2mb' }));
app.use('/api/auth', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));
app.use('/api/config/cv-pdf', express.raw({ type: 'application/pdf', limit: '10mb' }));

app.use('/files/:folder/:filename(*)', async (req, res) => {
  try {
    const userId = await requireCurrentUserId(req);
    const { folder, filename } = req.params;
    if (!['output', 'reports'].includes(folder)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const baseDir = path.resolve(repoRoot, folder);
    const normalizedBase = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
    const safePath = path.resolve(baseDir, filename);
    if (!safePath.startsWith(normalizedBase)) {
      return res.status(403).json({ error: 'Directory traversal detected.' });
    }
    if (folder === 'output') {
      const normFile = filename.replace(/\\/g, '/');
      const baseName = path.basename(filename);
      const relPath = `output/${normFile}`;
      const allowed = await query(
        `SELECT id FROM resumes
         WHERE user_id = :userId
           AND (
             pdf_path = :normFile OR html_path = :normFile
             OR pdf_path = :relPath OR html_path = :relPath
             OR pdf_path = :baseName OR html_path = :baseName
           )
         LIMIT 1`,
        { userId, normFile, relPath, baseName }
      );
      if (!allowed.length) {
        return res.status(403).json({ error: 'Access denied to this file.' });
      }
    }
    if (folder === 'reports') {
      const match = filename.match(/^u(\d+)_/);
      if (!match || Number(match[1]) !== Number(userId)) {
        return res.status(403).json({ error: 'Access denied to this report file.' });
      }
    }
    return res.sendFile(safePath);
  } catch {
    return res.status(401).json({ error: 'Unauthorized file access. Please authenticate first.' });
  }
});

app.get('/health', async (_req, res) => {
  try {
    const healthTimeout = new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Database health check timed out (2500ms)')), 2500);
      timer.unref?.();
    });
    await Promise.race([query('SELECT 1 AS ok'), healthTimeout]);
    res.json({ ok: true, service: 'job-ops-frontend-bridge', database: 'connected' });
  } catch (error) {
    res.status(500).json({
      ok: false,
      service: 'job-ops-frontend-bridge',
      database: 'disconnected',
      error: error.message
    });
  }
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/config', configRouter);
app.use('/api/scan-results', scannerRouter);
app.use('/api/scan', scannerRouter);
app.use('/api/evaluate', evaluateRouter);
app.use('/api/resume', resumeRouter);
app.use('/api/activity', activityRouter);
app.use('/api/usage', usageRouter);
app.use('/api/ops', opsRouter);

app.use((error, _req, res, _next) => {
  res.status(error.statusCode || 500).json({
    error: error.message || 'Unexpected server error'
  });
});

let server = null;
if (process.env.NODE_ENV !== 'test' && !process.env.DISABLE_SERVER_LISTEN) {
  server = app.listen(port, host, () => {
    console.log(`JOB-OPS bridge on http://${host}:${port}`);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.warn('WARNING: server is exposed beyond localhost. Authentication is not designed for public exposure.');
    }
  });
}

export { app, server };
export default app;
