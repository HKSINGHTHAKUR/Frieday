/**
 * Sync routes (architecture.md §5, tasks.md T2.3). Thin: auth → service →
 * shape. All orchestration lives in `services/sync/`; no GitHub calls here.
 *
 * POST /api/sync — claim the single-flight job and start the run in the
 * background. 202 with the job snapshot; 409 SYNC_CONFLICT with the current
 * job when a sync is already active for this user.
 *
 * GET /api/sync/status — latest user-scoped job + per-resource states shaped
 * per the documented contract. Clean `idle` payload when nothing ran yet.
 */
const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const { envelope, STATUS_BY_CODE } = require('../middleware/errorHandler');
const { startSync, getStatus } = require('../services/sync/sync.service');

function sendSyncError(req, res, err) {
  const code = err && typeof err.code === 'string' && STATUS_BY_CODE[err.code] ? err.code : 'INTERNAL';
  const status = err && Number.isInteger(err.status) ? err.status : STATUS_BY_CODE[code];
  if (code === 'INTERNAL') {
    // err.message may embed driver/connection details — safe metadata only.
    req.log.error({ reqId: req.id, code, operation: 'sync' });
  } else {
    req.log.warn({ reqId: req.id, code, operation: 'sync' });
  }
  // INTERNAL hides the message (it may carry driver details); known codes
  // carry messages our own layers wrote (verified secret-free).
  const message = code === 'INTERNAL' ? 'Something went wrong.' : err.message;
  return res
    .status(status)
    .json(envelope({ code, message, details: err.details, retryable: Boolean(err.retryable) }));
}

function createSyncRouter({ authMiddleware = requireAuth, deps = {} } = {}) {
  const router = Router();

  router.post('/', authMiddleware, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const out = await startSync(req.user.id, { kind: body.kind, ...deps });
      req.log.info({ reqId: req.id, msg: 'sync started', jobId: out.jobId });
      return res.status(202).json(out);
    } catch (err) {
      return sendSyncError(req, res, err);
    }
  });

  router.get('/status', authMiddleware, async (req, res) => {
    try {
      return res.json(await getStatus(req.user.id, deps));
    } catch (err) {
      return sendSyncError(req, res, err);
    }
  });

  return router;
}

module.exports = createSyncRouter();
module.exports.createSyncRouter = createSyncRouter;
