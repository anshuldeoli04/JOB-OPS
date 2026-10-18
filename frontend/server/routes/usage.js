import express from 'express';
import { getGeminiUsageStats, readGeminiUsage } from '../../../config-utils.mjs';
import { requireCurrentUserId } from '../utils/currentUser.js';

const router = express.Router();
const LIMIT_ESTIMATE = 1500;

router.get('/', async (req, res, next) => {
  try {
    await requireCurrentUserId(req);
    const stats = getGeminiUsageStats();
    const usage = readGeminiUsage();
    res.json({
      today: stats.total,
      success: stats.success,
      failed: stats.failed,
      limit_estimate: LIMIT_ESTIMATE,
      history: usage
    });
  } catch (error) {
    next(error);
  }
});

export default router;
