import express from 'express';
import { hashPassword, verifyPassword } from '../utils/auth.js';
import { query, withTransaction } from '../utils/db.js';
import { getSessionUserId, setSessionUserId } from '../utils/sessionStore.js';
import { generateToken, issueTicket } from '../utils/tokenAuth.js';
import { resolveCurrentUserId, requireCurrentUserId } from '../utils/currentUser.js';
import { mapUserRow } from '../utils/sqlMappers.js';

const router = express.Router();

router.get('/session', async (req, res, next) => {
  try {
    const userId = await resolveCurrentUserId(req);
    if (!userId) {
      return res.json({ user: null });
    }

    const rows = await query(
      `SELECT
         u.id,
         u.name,
         u.email,
         el.slug AS experience_level,
         COALESCE(el.min_years, 0) AS experience_years,
         (
           SELECT role_name
           FROM user_target_roles utr
           WHERE utr.user_id = u.id AND utr.is_active = TRUE
           ORDER BY utr.id ASC
           LIMIT 1
         ) AS primary_target_role
       FROM users u
       LEFT JOIN experience_levels el ON el.id = u.experience_level_id
       WHERE u.id = :userId
       LIMIT 1`,
      { userId }
    );

    res.json({ user: mapUserRow(rows[0]) });
  } catch (error) {
    next(error);
  }
});

router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, experienceLevel = 'fresher', targetRole = '', cvContent = '' } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    // Password policy: minimum length 10, reject empty/whitespace
    if (typeof password !== 'string' || password.length < 10 || /\s/.test(password)) {
      return res.status(400).json({
        error: 'Password must be at least 10 characters long and cannot contain whitespace.'
      });
    }

    // Single-user local tool gate: allow signup only when users table is empty or ALLOW_SIGNUP=1
    const allowSignupEnv = process.env.ALLOW_SIGNUP === '1' || process.env.ALLOW_SIGNUP === 'true';
    if (!allowSignupEnv) {
      const userCountRows = await query(`SELECT COUNT(*) AS count FROM users`);
      const userCount = Number(userCountRows[0]?.count || 0);
      if (userCount > 0) {
        return res.status(403).json({
          error: 'Signup is disabled. Set ALLOW_SIGNUP=1 to register new accounts.'
        });
      }
    }

    const existing = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER(:email) LIMIT 1`,
      { email }
    );

    if (existing.length) {
      return res.status(409).json({ error: 'User already exists.' });
    }

    const levels = await query(
      `SELECT id, slug, min_years
       FROM experience_levels
       WHERE slug = :experienceLevel
       LIMIT 1`,
      { experienceLevel }
    );

    const level = levels[0];
    if (!level) {
      return res.status(400).json({ error: 'Invalid experience level.' });
    }

    const hashedPassword = await hashPassword(password);
    const userId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO users (name, email, password_hash, experience_level_id, token_version)
         VALUES (?, ?, ?, ?, 1)`,
        [name, email, hashedPassword, level.id]
      );

      if (targetRole) {
        await connection.execute(
          `INSERT INTO user_target_roles (user_id, role_name)
           VALUES (?, ?)`,
          [result.insertId, targetRole]
        );
      }

      if (cvContent && cvContent.trim().length > 30) {
        await connection.execute(
          `INSERT INTO user_cvs (user_id, version, content_md, is_current)
           VALUES (?, 1, ?, TRUE)`,
          [result.insertId, cvContent]
        );
      }

      return result.insertId;
    });
    await setSessionUserId(userId);
    const token = generateToken(userId, 1);

    res.status(201).json({
      token,
      user: {
        id: userId,
        name,
        email,
        experienceLevel: level.slug,
        experienceYears: level.min_years,
        targetRole
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const rows = await query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.password_hash,
         COALESCE(u.token_version, 1) AS token_version,
         el.slug AS experience_level,
         COALESCE(el.min_years, 0) AS experience_years,
         (
           SELECT role_name
           FROM user_target_roles utr
           WHERE utr.user_id = u.id AND utr.is_active = TRUE
           ORDER BY utr.id ASC
           LIMIT 1
         ) AS primary_target_role
       FROM users u
       LEFT JOIN experience_levels el ON el.id = u.experience_level_id
       WHERE LOWER(u.email) = LOWER(:email)
       LIMIT 1`,
      { email }
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    await setSessionUserId(user.id);
    const token = generateToken(user.id, user.token_version || 1);
    res.json({ user: mapUserRow(user), token });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const userId = await resolveCurrentUserId(req);
    if (userId) {
      await query(
        `UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = :userId`,
        { userId }
      ).catch(() => {});
    }
    await setSessionUserId(null);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/ticket', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const ticket = issueTicket(userId);
    res.json({ ticket, expiresInSeconds: 60 });
  } catch (error) {
    next(error);
  }
});

export default router;
