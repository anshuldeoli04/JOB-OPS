import express from 'express';
import { query } from '../utils/db.js';
import { requireCurrentUserId } from '../utils/currentUser.js';
import { mapActivityRow } from '../utils/sqlMappers.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const userId = await requireCurrentUserId(req);
    const rows = await query(
      `SELECT id, event_type, entity_type, entity_id, meta, created_at
       FROM activity_log
       WHERE user_id = :userId
       ORDER BY created_at DESC
       LIMIT 20`,
      { userId }
    );
    res.json(rows.map(mapActivityRow));
  } catch (error) {
    next(error);
  }
});

export default router;
