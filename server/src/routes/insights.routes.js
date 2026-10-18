/**
 * Insights routes — GET /api/insights?range= (T5.1) and
 * POST /api/insights/:id/explain (T6.1).
 *
 * Returns stored deterministic Insight data.
 * Cache: 60s in-process memo keyed by userId:range:lastSyncedAt.
 */

const { Router } = require('express');
const mongoose = require('mongoose');
const requireAuth = require('../middleware/requireAuth');
const { validate } = require('../utils/validation');
const { insightsQuerySchema } = require('../utils/validation');
const { STATUS_BY_CODE } = require('../middleware/errorHandler');
const { get: getCache, set: setCache } = require('../utils/apiCache');
const { getEnv } = require('../config/env');
const SyncState = require('../models/SyncState');
const Insight = require('../models/Insight');
const { getLastRecomputeAt, isCacheValid } = require('../services/intelligence/composer-core');
const { recomputeIntelligence } = require('../services/intelligence/composer');
const { createAiExplainer, buildInsightInput } = require('../services/ai/explainer.interface');

function sendError(req, res, err) {
  const code = err && typeof err.code === 'string' && STATUS_BY_CODE[err.code] ? err.code : 'INTERNAL';
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  if (code === 'INTERNAL') {
    // err.message may embed driver/connection details — safe metadata only.
    req.log.error({ reqId: req.id, code, operation: 'insights' });
  } else {
    req.log.warn({ reqId: req.id, code, operation: 'insights' });
  }
  // INTERNAL hides the message (it may carry driver details); known codes
  // carry messages our own layers wrote (verified secret-free).
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

async function insightsHandler(deps, req, res) {
  const userId = req.user.id;
  const { range } = req.query;

  try {
    // Get lastSyncedAt for cache key
    const lastSyncedAt = deps.getLastSyncedAt
      ? await deps.getLastSyncedAt(req.user.id)
      : await getLastSyncedAt(req.user.id);

    // Try cache first
    if (lastSyncedAt) {
      const cached = getCache('insights', userId, range, lastSyncedAt.toISOString());
      if (cached && cached.insights) {
        return res.json({ insights: cached.insights, fromCache: true });
      }
    }

    // Freshen stored insights per architecture.md §10: recompute (persisting
    // a new generatedAt) only when SyncState changed since the last
    // computation; when fresh, serve the persisted docs as-is. This keeps the
    // displayed "generated X ago" timestamp tied to the insight actually being
    // served and never recomputes on a per-request basis.
    const lastRecomputeAt = deps.getLastRecomputeAt
      ? await deps.getLastRecomputeAt(userId, range)
      : await getLastRecomputeAt(userId, range);
    const fresh = deps.isCacheValid
      ? await deps.isCacheValid(userId, range, lastRecomputeAt)
      : await isCacheValid(userId, range, lastRecomputeAt);
    if (!fresh) {
      if (deps.recomputeIntelligence) {
        await deps.recomputeIntelligence({ userId, range });
      } else {
        await recomputeIntelligence({ userId, range });
      }
    }

    // Cache miss - fetch from database
    const insights = deps.findInsights
      ? await deps.findInsights(userId, range)
      : await Insight.find({ userId: new mongoose.Types.ObjectId(req.user.id), range })
          .sort({ generatedAt: -1 })
          .lean();

    // Transform to API shape
    // `id` (added T6.2): keys the per-insight Explain endpoint
    // (POST /api/insights/:id/explain). Additive, non-breaking.
    const insightsData = insights.map((i) => ({
      id: i._id.toString(),
      templateId: i.templateId,
      title: i.title,
      text: i.text,
      metrics: i.metrics,
      evidence: i.evidence,
      confidence: i.confidence,
      generatedAt: i.generatedAt,
    }));

    // Cache the result
    if (lastSyncedAt) {
      setCache('insights', req.user.id, range, lastSyncedAt.toISOString(), { insights: insightsData });
    }

    return res.json({ insights: insightsData, fromCache: false });
  } catch (err) {
    return sendError(req, res, err);
  }
}

/**
 * POST /api/insights/:id/explain (T6.1, tasks.md, architecture.md §5)
 * MVP (AI_ENABLED=false): 501 AI_DISABLED. Enabled: paraphrase the stored
 * insight through the AIExplainer contract; any AI failure degrades to the
 * deterministic template text with aiLabel: false.
 *
 * AI-off default branch runs before any DB access, so the disabled path is
 * safe without a database.
 */
async function explainHandler(deps, req, res) {
  const config = deps.config ?? getEnv();
  if (!config.AI_ENABLED) {
    return res.status(501).json({
      error: { code: 'AI_DISABLED', message: 'AI explanations are not enabled.', retryable: false },
    });
  }

  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!mongoose.Types.ObjectId.isValid(id)) {
    // Same safe 404 as a valid-but-foreign id: no cross-user information.
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Insight not found.', retryable: false },
    });
  }

  let insight;
  try {
    insight = deps.findInsight
      ? await deps.findInsight(id, req.user.id)
      : await Insight.findOne({
          _id: new mongoose.Types.ObjectId(id),
          userId: new mongoose.Types.ObjectId(req.user.id),
        }).lean();
  } catch (err) {
    return sendError(req, res, err);
  }
  if (!insight) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Insight not found.', retryable: false },
    });
  }

  const input = buildInsightInput({
    insightTemplateId: insight.templateId,
    insightText: insight.text,
    metrics: insight.metrics,
    evidenceSummary: buildEvidenceSummary(insight.evidence),
    timeRange: insight.range,
  });
  if (!input) {
    return res.status(503).json({
      error: { code: 'INTERNAL', message: 'Could not build a safe explanation input.', retryable: false },
    });
  }

  const explainer = createAiExplainer({ config, fetchImpl: deps.fetchImpl });
  try {
    const result = await explainer.explain(input);
    // fallbackReason stays internal (route log only) — the client gets the
    // contract fields plus the honest aiLabel flag.
    if (result.fallbackReason) {
      req.log.warn({ reqId: req.id, msg: 'ai fallback', reason: result.fallbackReason });
    }
    return res.json({
      paraphrase: result.paraphrase,
      whyItMatters: result.whyItMatters,
      aiLabel: Boolean(result.aiLabel),
    });
  } catch (err) {
    return sendError(req, res, err);
  }
}

/**
 * Evidence summary for the AI contract: identifiers + counts only. Raw
 * commit/issue/PR text never enters the AI layer (prd.md §19).
 */
function buildEvidenceSummary(evidence) {
  const repoIds = (evidence && Array.isArray(evidence.repoIds) ? evidence.repoIds : []).map(String);
  const bucketStarts = (evidence && Array.isArray(evidence.bucketStarts) ? evidence.bucketStarts : []).map(
    (d) => new Date(d).toISOString()
  );
  const commitShas = (evidence && Array.isArray(evidence.commitShas) ? evidence.commitShas : []).length;
  const prNumbers = (evidence && Array.isArray(evidence.prNumbers) ? evidence.prNumbers : []).length;
  return {
    repoIds,
    bucketStarts,
    counts: {
      repos: repoIds.length,
      commits: commitShas,
      pullRequests: prNumbers,
      buckets: bucketStarts.length,
    },
  };
}

/**
 * Factory form (matching createSyncRouter) so tests can inject fake auth,
 * a DB-free insight lookup, and a scripted fetch; the default export is the
 * production router.
 */
function createInsightsRouter({ authMiddleware = requireAuth, deps = {} } = {}) {
  const router = Router();
  router.get('/insights', authMiddleware, validate(insightsQuerySchema), (req, res) =>
    insightsHandler(deps, req, res)
  );
  router.post('/insights/:id/explain', authMiddleware, (req, res) => explainHandler(deps, req, res));
  return router;
}

module.exports = createInsightsRouter();
module.exports.createInsightsRouter = createInsightsRouter;
