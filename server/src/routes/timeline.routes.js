/**
 * Timeline routes (T5.1) — GET /api/timeline
 *
 * Uses existing Phase 4 timeline intelligence.
 */

const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const { validate } = require('../utils/validation');
const { timelineQuerySchema } = require('../utils/validation');
const { STATUS_BY_CODE } = require('../middleware/errorHandler');
const { composeIntelligence, effectiveGranularity } = require('../services/intelligence/composer');
const { loadRawData } = require('../services/intelligence/composer-data');
const { persistPerRepoActivityBuckets } = require('../services/intelligence/composer-persist');
const { get: getCache, set: setCache } = require('../utils/apiCache');
const SyncState = require('../models/SyncState');
const ActivityBucket = require('../models/ActivityBucket');
const mongoose = require('mongoose');
const { dayStartUTC } = require('../utils/dates');
const { rangeStart, computeTimeline } = require('../services/intelligence/timeline');

function sendError(req, res, err) {
  const code = err && typeof err.code === 'string' && STATUS_BY_CODE[err.code] ? err.code : 'INTERNAL';
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  if (code === 'INTERNAL') {
    req.log.error({ reqId: req.id, code, operation: 'timeline' });
  } else {
    req.log.warn({ reqId: req.id, code, operation: 'timeline' });
  }
  const message = code === 'INTERNAL' ? 'Something went wrong.' : err.message;
  return res
    .status(status)
    .json({ error: { code, message, details: err.details, retryable: Boolean(err.retryable) } });
}

async function getLastSyncedAt(userId) {
  const states = await SyncState.find({ userId }).select('lastSyncedAt').lean();
  if (!states.length) return null;
  return states.reduce((max, s) => (s.lastSyncedAt > max ? s.lastSyncedAt : max), null);
}

async function getRepoBuckets(userId, repoId, range, granularity) {
  const effGranularity = granularity ?? effectiveGranularity(range);
  const repoBuckets = await ActivityBucket.find({
    userId,
    repoId: new mongoose.Types.ObjectId(repoId),
    range,
    granularity: effGranularity,
    bucketStart: { $gte: rangeStart(range, dayStartUTC(new Date())), $lte: dayStartUTC(new Date()) },
  })
    .sort({ bucketStart: 1 })
    .lean();

  if (!repoBuckets.length) {
    // Compute + persist the repo-filtered timeline at the requested granularity
    const rawData = await loadRawData(userId, range, dayStartUTC(new Date()));
    const repoTimeline = computeTimeline({
      range,
      anchor: new Date(),
      commits: rawData.commits.filter((c) => c.repoId?.toString() === repoId),
      pullRequests: rawData.pullRequests.filter((pr) => pr.repoId?.toString() === repoId),
      issues: rawData.issues.filter((i) => i.repoId?.toString() === repoId),
      repoFilter: { repoId },
      granularity: effGranularity,
    });

    // Wipe this repo's stale bucket rows for the range before rebuilding
    // (legacy rows lack granularity and would collide on the unique index).
    await ActivityBucket.deleteMany({
      userId,
      repoId: new mongoose.Types.ObjectId(repoId),
      range,
    });

    await persistPerRepoActivityBuckets(userId, range, rawData, effGranularity);

    return repoTimeline.map((bucket) => ({
      bucketStart: bucket.bucketStart,
      commits: bucket.commits,
      prsOpened: bucket.prsOpened,
      prsMerged: bucket.prsMerged,
      issuesTouched: bucket.issuesTouched,
    }));
  }

  return repoBuckets.map((b) => ({
    bucketStart: b.bucketStart,
    commits: b.commits,
    prsOpened: b.prsOpened,
    prsMerged: b.prsMerged,
    issuesTouched: b.issuesTouched,
  }));
}

async function timelineHandler(req, res) {
  const userId = req.user.id;
  const { range, repoId, granularity } = req.query;
  const effGranularity = granularity ?? effectiveGranularity(range);

  try {
    const lastSyncedAt = await getLastSyncedAt(req.user.id);

    if (lastSyncedAt) {
      const cached = getCache('timeline', userId, range, lastSyncedAt.toISOString(), effGranularity);
      if (cached && cached.buckets) {
        if (repoId) {
          const repoBuckets = await getRepoBuckets(userId, repoId, range, granularity);
          return res.json({ buckets: repoBuckets, fromCache: true });
        }
        return res.json({ buckets: cached.buckets, fromCache: true });
      }
    }

    const payload = await composeIntelligence({ userId: req.user.id, range, granularity });

    let buckets = payload.buckets;
    if (repoId) {
      buckets = await getRepoBuckets(userId, repoId, range, granularity);
    } else if (lastSyncedAt) {
      setCache('timeline', userId, range, lastSyncedAt.toISOString(), { buckets }, effGranularity);
    }

    return res.json({ buckets, fromCache: false });
  } catch (err) {
    return sendError(req, res, err);
  }
}

const router = Router();

router.get('/timeline', requireAuth, validate(timelineQuerySchema), timelineHandler);

module.exports = router;
