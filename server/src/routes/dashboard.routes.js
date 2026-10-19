/**
 * Dashboard routes (T5.1) — thin API layer over Phase 4 intelligence composer.
 *
 * GET /api/dashboard?range=30d|90d|12m
 *
 * Returns Phase 4 GET-ready intelligence payload.
 * Cache: 60s in-process memo keyed by userId:range:lastSyncedAt.
 */

const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const { validate } = require('../utils/validation');
const { dashboardQuerySchema } = require('../utils/validation');
const { composeIntelligence } = require('../services/intelligence/composer');
const { get: getCache, set: setCache } = require('../utils/apiCache');
const SyncState = require('../models/SyncState');
const { STATUS_BY_CODE } = require('../middleware/errorHandler');

function sendError(req, res, err) {
  const code = err && typeof err.code === 'string' && STATUS_BY_CODE[err.code] ? err.code : 'INTERNAL';
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  if (code === 'INTERNAL') {
    // err.message may embed driver/connection details — safe metadata only.
    req.log.error({ reqId: req.id, code, operation: 'dashboard' });
  } else {
    req.log.warn({ reqId: req.id, code, operation: 'dashboard' });
  }
  // INTERNAL hides the message (it may carry driver details); known codes
  // carry messages our own layers wrote (verified secret-free).
  const message = code === 'INTERNAL' ? 'Something went wrong.' : err.message;
  return res
    .status(status)
    .json({ error: { code, message, details: err.details, retryable: Boolean(err.retryable) } });
}

async function getLastSyncedAt(userId) {
  // Get the most recent lastSyncedAt from SyncState for this user
  const states = await SyncState.find({ userId }).select('lastSyncedAt').lean();
  if (!states.length) return null;
  return states.reduce((max, s) => (s.lastSyncedAt > max ? s.lastSyncedAt : max), null);
}

async function dashboardHandler(req, res) {
  const userId = req.user.id;
  const { range } = req.query;

  try {
    // Get lastSyncedAt for cache key
    const lastSyncedAt = await getLastSyncedAt(req.user.id);

    // Try cache first
    if (lastSyncedAt) {
      const cached = getCache('dashboard', userId, range, lastSyncedAt.toISOString());
      if (cached) {
        return res.json({ ...cached, fromCache: true });
      }
    }

    // Cache miss - compute
    const result = await composeIntelligence({ userId, range });

    // Cache the result
    if (lastSyncedAt) {
      setCache('dashboard', userId, range, lastSyncedAt.toISOString(), result);
    }

    return res.json(result);
  } catch (err) {
    req.log.error({
      reqId: req.id,
      code: 'INTERNAL',
      operation: 'dashboard',
      message: err && err.message,
      stack: err && err.stack,
    });
    return sendError(req, res, err);
  }
}

const router = Router();

router.get('/dashboard', requireAuth, validate(dashboardQuerySchema), dashboardHandler);

module.exports = router;
