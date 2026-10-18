import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from '../utils/db.js';
import { requireCurrentUserId } from '../utils/currentUser.js';
import { extractTextFromPdfBuffer } from '../utils/cvParser.js';
import { decryptSecret, encryptSecret } from '../utils/secrets.js';

const router = express.Router();
const DEFAULT_MODEL = 'gemini-2.5-flash';
const API_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{10,}$/;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_MAX_ENTRIES = 1000;
const keyTestAttempts = new Map();

const PDF_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PDF_RATE_LIMIT_MAX_ATTEMPTS = 5;
const PDF_RATE_LIMIT_MAX_ENTRIES = 1000;
const pdfParseAttempts = new Map();

// Auto-cleanup timer to prevent memory leaks from inactive IPs
const rateLimitCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [id, timestamps] of keyTestAttempts.entries()) {
    const valid = timestamps.filter((t) => t > cutoff);
    if (valid.length === 0) {
      keyTestAttempts.delete(id);
    } else {
      keyTestAttempts.set(id, valid);
    }
  }

  const pdfCutoff = Date.now() - PDF_RATE_LIMIT_WINDOW_MS;
  for (const [id, timestamps] of pdfParseAttempts.entries()) {
    const valid = timestamps.filter((t) => t > pdfCutoff);
    if (valid.length === 0) {
      pdfParseAttempts.delete(id);
    } else {
      pdfParseAttempts.set(id, valid);
    }
  }
}, 2 * 60 * 1000);
if (rateLimitCleanupTimer.unref) rateLimitCleanupTimer.unref();

function maskApiKey(apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

function normalizeList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function normalizeText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseExpectedCtc(rawValue) {
  const [minCtc, maxCtc] = String(rawValue || '')
    .split('-')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));

  return {
    minCtc: Number.isFinite(minCtc) ? minCtc : null,
    maxCtc: Number.isFinite(maxCtc) ? maxCtc : null
  };
}

function buildConfigResponse(user = {}, roles = [], locations = [], cvs = []) {
  const decryptedKey = decryptSecret(user.gemini_api_key || '');
  const hasKey = Boolean(String(decryptedKey || '').trim());
  const cvContent = cvs[0]?.content_md || '';
  const hasCv = cvContent.trim().length > 30;

  return {
    name: user.name || '',
    gemini_model: user.gemini_model || DEFAULT_MODEL,
    key_masked: maskApiKey(decryptedKey),
    has_key: hasKey,
    has_cv: hasCv,
    configured: hasKey && hasCv,
    experience_level: user.experience_level || 'fresher',
    experience_years: user.experience_years || 0,
    expected_ctc_lpa:
      user.expected_ctc_min != null && user.expected_ctc_max != null
        ? `${user.expected_ctc_min}-${user.expected_ctc_max}`
        : '',
    target_roles: roles.map((item) => item.role_name),
    target_locations: locations.map((item) => item.location_name),
    cv_content: cvContent
  };
}

function enforceKeyTestRateLimit(req) {
  const identifier = String(req.ip || 'unknown');
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recentAttempts = (keyTestAttempts.get(identifier) || []).filter((timestamp) => timestamp > windowStart);

  if (recentAttempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    const error = new Error('Too many key test attempts. Please wait a minute and try again.');
    error.statusCode = 429;
    throw error;
  }

  if (keyTestAttempts.size >= RATE_LIMIT_MAX_ENTRIES && !keyTestAttempts.has(identifier)) {
    const oldestKey = keyTestAttempts.keys().next().value;
    if (oldestKey) keyTestAttempts.delete(oldestKey);
  }

  recentAttempts.push(now);
  keyTestAttempts.set(identifier, recentAttempts);
}

function enforcePdfParseRateLimit(req) {
  const identifier = String(req.ip || 'unknown');
  const now = Date.now();
  const windowStart = now - PDF_RATE_LIMIT_WINDOW_MS;
  const recentAttempts = (pdfParseAttempts.get(identifier) || []).filter((timestamp) => timestamp > windowStart);

  if (recentAttempts.length >= PDF_RATE_LIMIT_MAX_ATTEMPTS) {
    const error = new Error('Too many PDF parse attempts. Please wait a minute and try again.');
    error.statusCode = 429;
    throw error;
  }

  if (pdfParseAttempts.size >= PDF_RATE_LIMIT_MAX_ENTRIES && !pdfParseAttempts.has(identifier)) {
    const oldestKey = pdfParseAttempts.keys().next().value;
    if (oldestKey) pdfParseAttempts.delete(oldestKey);
  }

  recentAttempts.push(now);
  pdfParseAttempts.set(identifier, recentAttempts);
}

async function loadConfigBundle(userId) {
  const [users, roles, locations, cvs] = await Promise.all([
    query(
      `SELECT
         u.name,
         u.gemini_api_key,
         u.gemini_model,
         u.expected_ctc_min,
         u.expected_ctc_max,
         el.slug AS experience_level,
         COALESCE(el.min_years, 0) AS experience_years
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

  return { user: users[0] || {}, roles, locations, cvs };
}

async function verifyGeminiKey(apiKey, modelName = DEFAULT_MODEL) {
  if (!API_KEY_PATTERN.test(apiKey)) {
    const error = new Error('Gemini API key format invalid.');
    error.statusCode = 400;
    throw error;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName || DEFAULT_MODEL });
    await model.generateContent('Reply with only: ok');
    return true;
  } catch {
    const error = new Error('Invalid or expired API key.');
    error.statusCode = 400;
    throw error;
  }
}

router.get('/status', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const { user, cvs } = await loadConfigBundle(userId);
    const hasKey = Boolean(String(user.gemini_api_key || '').trim());
    const hasCv = Boolean((cvs[0]?.content_md || '').trim().length > 30);

    res.json({
      configured: hasKey && hasCv,
      has_key: hasKey,
      has_cv: hasCv
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const { user, roles, locations, cvs } = await loadConfigBundle(userId);
    res.json(buildConfigResponse(user, roles, locations, cvs));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const payload = req.body || {};
    const roles = normalizeList(payload.target_roles);
    const locations = normalizeList(payload.target_locations);
    const name = normalizeText(payload.name, 120);
    const geminiModel = normalizeText(payload.gemini_model, 80) || DEFAULT_MODEL;
    const cvContent = String(payload.cv_content || '').trim();
    const incomingApiKey = typeof payload.gemini_api_key === 'string' ? payload.gemini_api_key.trim() : '';
    const shouldUpdateApiKey = incomingApiKey.length > 0;
    const { minCtc, maxCtc } = parseExpectedCtc(payload.expected_ctc_lpa);

    const levels = await query(
      `SELECT id FROM experience_levels WHERE slug = :slug LIMIT 1`,
      { slug: payload.experience_level || 'fresher' }
    );

    const levelId = levels[0]?.id || 1;

    if (cvContent.length > 50000) {
      return res.status(400).json({ error: 'CV content too large. Keep it under 50KB.' });
    }

    if (shouldUpdateApiKey) {
      enforceKeyTestRateLimit(req);
      await verifyGeminiKey(incomingApiKey, geminiModel);
    }

    await query(
      `UPDATE users
       SET
         name = :name,
         gemini_api_key = CASE WHEN :shouldUpdateApiKey THEN :geminiApiKey ELSE gemini_api_key END,
         gemini_model = :geminiModel,
         expected_ctc_min = :minCtc,
         expected_ctc_max = :maxCtc,
         experience_level_id = :levelId
       WHERE id = :userId`,
      {
        userId,
        name,
        geminiApiKey: shouldUpdateApiKey ? encryptSecret(incomingApiKey) : null,
        shouldUpdateApiKey,
        geminiModel,
        minCtc,
        maxCtc,
        levelId
      }
    );

    await query(`DELETE FROM user_target_roles WHERE user_id = :userId`, { userId });
    await query(`DELETE FROM user_target_locations WHERE user_id = :userId`, { userId });

    for (const role of roles) {
      await query(
        `INSERT INTO user_target_roles (user_id, role_name)
         VALUES (:userId, :role)`,
        { userId, role }
      );
    }

    for (const location of locations) {
      await query(
        `INSERT INTO user_target_locations (user_id, location_name)
         VALUES (:userId, :location)`,
        { userId, location }
      );
    }

    if (cvContent.length > 30) {
      await query(`UPDATE user_cvs SET is_current = FALSE WHERE user_id = :userId AND is_current = TRUE`, { userId });
      const versionRows = await query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM user_cvs WHERE user_id = :userId`,
        { userId }
      );
      await query(
        `INSERT INTO user_cvs (user_id, version, content_md, is_current)
         VALUES (:userId, :version, :content, TRUE)`,
        {
          userId,
          version: versionRows[0]?.next_version || 1,
          content: cvContent
        }
      );
    }

    const { user, roles: updatedRoles, locations: updatedLocations, cvs } = await loadConfigBundle(userId);
    res.json({
      config: buildConfigResponse(user, updatedRoles, updatedLocations, cvs)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/test-key', async (req, res, next) => {
  try {
    await requireCurrentUserId(req);
    enforceKeyTestRateLimit(req);
    const payload = req.body || {};
    const apiKey = String(payload.api_key || '').trim();
    const modelName = normalizeText(payload.gemini_model, 80) || DEFAULT_MODEL;
    await verifyGeminiKey(apiKey, modelName);
    res.json({ valid: true });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 429) {
      return res.status(error.statusCode).json({ valid: false, error: error.message });
    }
    next(error);
  }
});

router.post('/update-key', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const apiKey = String(req.body?.api_key || '').trim();
    const modelName = normalizeText(req.body?.gemini_model, 80) || DEFAULT_MODEL;

    enforceKeyTestRateLimit(req);
    await verifyGeminiKey(apiKey, modelName);

    await query(
      `UPDATE users
       SET gemini_api_key = :apiKey,
           gemini_model = COALESCE(NULLIF(:modelName, ''), gemini_model)
       WHERE id = :userId`,
      {
        userId,
        apiKey: encryptSecret(apiKey),
        modelName,
      }
    );

    const { user, roles, locations, cvs } = await loadConfigBundle(userId);
    res.json({
      success: true,
      config: buildConfigResponse(user, roles, locations, cvs)
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
});

router.post('/cv-pdf', async (req, res, next) => {
  try {
    enforcePdfParseRateLimit(req);
    const pdfBuffer = req.body;
    if (!pdfBuffer || !pdfBuffer.length) {
      return res.status(400).json({ error: 'PDF file body missing.' });
    }

    const cvContent = await extractTextFromPdfBuffer(pdfBuffer);
    if (!cvContent || cvContent.trim().length < 30) {
      return res.status(400).json({ error: 'PDF se readable CV text extract nahi hua.' });
    }

    res.json({ cv_content: cvContent });
  } catch (error) {
    next(error);
  }
});

export default router;
