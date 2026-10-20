/**
 * Intelligence Composer (T4.3) — orchestrates raw data loading, intelligence
 * computation, derived persistence, and caching via SyncState.
 *
 * This is the ONLY place in the intelligence layer that touches the database.
 * Pure intelligence functions (timeline, languages, focus, consistency, deltas,
 * repoHealth, insights) remain pure and are imported from their modules.
 */

const ActivityBucket = require('../../models/ActivityBucket');
const Insight = require('../../models/Insight');

const intelligence = require('./index');

const { RANGES, isCacheValid, getLastRecomputeAt } = require('./composer-core');
const { loadRawData } = require('./composer-data');
const { persistActivityBuckets, persistInsights } = require('./composer-persist');
const { computeIntelligenceForPeriod, evaluateInsightsFromPayload } = require('./composer-compute');

/**
 * Resolve the effective bucket granularity for a request. Defaults to the
 * range's canonical granularity (prd.md §9 F4: 30d = day, 90d/12m = week);
 * an explicit `granularity` override wins.
 * @param {string} range
 * @param {string|null} [granularity]
 * @returns {'day'|'week'}
 */
function effectiveGranularity(range, granularity) {
  return granularity ?? intelligence.timeline.bucketTypeForRange(range);
}

/**
 * Main composer entry point.
 * Returns the complete GET-ready intelligence payload.
 *
 * @param {Object} opts
 * @param {string} opts.userId - user ObjectId string
 * @param {string} opts.range - '30d', '90d', or '12m'
 * @param {string} [opts.granularity] - 'day' or 'week' (optional, defaults based on range)
 * @param {Date} [opts.anchor] - anchor date (default: now)
 * @returns {Object} complete intelligence payload
 */
async function composeIntelligence({ userId, range, granularity, anchor = new Date() } = {}) {
  if (!RANGES.includes(range)) {
    throw new Error(`Invalid range: ${range}. Must be one of ${RANGES.join(', ')}`);
  }

  // Normalize anchor to day start UTC
  const dayStartUTC = require('../../utils/dates').dayStartUTC;
  const normalizedAnchor = dayStartUTC(anchor);

  // Check cache validity
  const lastRecomputeAt = await getLastRecomputeAt(userId, range);
  const cacheValid = await isCacheValid(userId, range, lastRecomputeAt);
  const effGranularity = effectiveGranularity(range, granularity);

  // Load cached buckets at the requested granularity. If none exist at this
  // granularity (e.g. pre-granularity data or a granularity that was never
  // computed), treat it as a cache MISS and recompute below.
  const cachedBuckets =
    cacheValid && lastRecomputeAt
      ? await ActivityBucket.find({ userId, range, granularity: effGranularity, repoId: null })
          .sort({ bucketStart: 1 })
          .lean()
      : [];

  if (cacheValid && lastRecomputeAt && cachedBuckets.length > 0) {
    // CACHE HIT: Load from cached derived data (same granularity only)
    const cachedInsights = await Insight.find({ userId, range }).sort({ generatedAt: -1 }).lean();

    // Reconstruct timeline from cached ActivityBuckets
    const timeline = cachedBuckets.map((b) => ({
      bucketStart: b.bucketStart,
      commits: b.commits,
      prsOpened: b.prsOpened,
      prsMerged: b.prsMerged,
      issuesTouched: b.issuesTouched,
    }));

    // Reconstruct insights from cached Insight documents.
    // All stored docs for this user/range are returned (one per templateId
    // for aggregate templates, one per (templateId, repoId) for per-repo
    // templates such as project_health). No templateId dedup: that dedup was
    // masking FIND-1 where per-repo project_health insights collapsed to one.
    const insights = cachedInsights.map((i) => ({
      templateId: i.templateId,
      title: i.title,
      text: i.text,
      metrics: i.metrics,
      evidence: i.evidence,
      confidence: i.confidence,
      timeRange: i.timeRange ?? null,
      generatedAt: i.generatedAt,
    }));

    // Load raw data to compute non-cached components (languages, focus,
    // consistency, deltas, repoHealth) for the cache-hit response.
    const rawData = await loadRawData(userId, range, normalizedAnchor);

    const [languages, focus, themes, consistency, deltas, repoHealth] = await Promise.all([
      Promise.resolve(
        intelligence.languages.computeLanguageAggregation({
          commits: rawData.commits,
          languageSnapshots: rawData.languageSnapshots,
        })
      ),
      Promise.resolve(
        intelligence.focus.computeFocusTags({
          commits: rawData.commits,
          languageSnapshots: rawData.languageSnapshots,
          repositories: rawData.repositories,
        })
      ),
      Promise.resolve(
        intelligence.themes.computeThemes({
          commits: rawData.commits,
          repositories: rawData.repositories,
        })
      ),
      Promise.resolve(
        intelligence.consistency.computeConsistency({
          range,
          anchor: normalizedAnchor,
          commits: rawData.commits,
          pullRequests: rawData.pullRequests,
          issues: rawData.issues,
        })
      ),
      Promise.resolve(
        intelligence.deltas.computeDeltas({
          current: { commits: rawData.commits.length },
          previous: { commits: 0 },
        })
      ),
      Promise.resolve(
        intelligence.repoHealth.computeAllRepoHealth({
          repositories: rawData.repositories,
          anchor: normalizedAnchor,
          commits: rawData.commits,
          pullRequests: rawData.pullRequests,
          issues: rawData.issues,
        })
      ),
    ]);

    return {
      kpis: {
        totalCommits: rawData.commits.length,
        totalPRs: rawData.pullRequests.length,
        totalIssues: rawData.issues.length,
        activeDays: consistency.activeDays,
        currentStreak: consistency.currentStreak,
        longestStreak: consistency.longestStreak,
        repoCount: rawData.repositories.length,
      },
      buckets: timeline,
      languages,
      focus,
      themes,
      consistency,
      deltas,
      repoHealth,
      insights,
      fromCache: true,
    };
  }

  // CACHE MISS or RECOMPUTE: Load raw data and compute
  const rawData = await loadRawData(userId, range, normalizedAnchor);

  const payload = await computeIntelligenceForPeriod(userId, range, normalizedAnchor, rawData, granularity);

  // Fill in the consistency object properly
  const consistencyResult = intelligence.consistency.computeConsistency({
    range,
    anchor: normalizedAnchor,
    commits: rawData.commits,
    pullRequests: rawData.pullRequests,
    issues: rawData.issues,
  });
  payload.consistency = consistencyResult;

  // Commit themes (Phase 10.1) — computed on demand from the same
  // user-scoped commits. No persistence, no extra query.
  payload.themes = intelligence.themes.computeThemes({
    commits: rawData.commits,
    repositories: rawData.repositories,
  });

  // Evaluate insights
  const insights = evaluateInsightsFromPayload(
    {
      raw: {
        commits: rawData.commits,
        pullRequests: rawData.pullRequests,
        issues: rawData.issues,
        repositories: rawData.repositories,
        timeline: payload.timeline,
        languages: payload.languages,
        focus: payload.focus,
        consistency: payload.consistency,
        repoHealth: payload.repoHealth,
      },
      previous: payload.previous,
    },
    range,
    normalizedAnchor,
    rawData.repositories
  );

  // Persist derived data
  const generatedAt = new Date();
  await Promise.all([
    persistActivityBuckets(userId, range, payload.timeline, rawData, effectiveGranularity(range)),
    persistInsights(userId, range, insights, generatedAt),
  ]);

  return {
    kpis: {
      totalCommits: rawData.commits.length,
      totalPRs: rawData.pullRequests.length,
      totalIssues: rawData.issues.length,
      activeDays: payload.consistency.activeDays,
      currentStreak: payload.consistency.currentStreak,
      longestStreak: payload.consistency.longestStreak,
      repoCount: rawData.repositories.length,
    },
    buckets: payload.timeline,
    languages: payload.languages,
    focus: payload.focus,
    themes: payload.themes,
    consistency: payload.consistency,
    deltas: payload.deltas,
    repoHealth: payload.repoHealth,
    insights,
  };
}

/**
 * Recompute intelligence for a user/range (used after sync completes).
 * Forces recompute regardless of cache state.
 */
async function recomputeIntelligence({ userId, range, anchor = new Date() } = {}) {
  if (!RANGES.includes(range)) {
    throw new Error(`Invalid range: ${range}. Must be one of ${RANGES.join(', ')}`);
  }

  const dayStartUTC = require('../../utils/dates').dayStartUTC;
  const normalizedAnchor = dayStartUTC(anchor);

  const rawData = await loadRawData(userId, range, normalizedAnchor);

  const payload = await computeIntelligenceForPeriod(userId, range, normalizedAnchor, rawData);

  const consistencyResult = intelligence.consistency.computeConsistency({
    range,
    anchor: normalizedAnchor,
    commits: rawData.commits,
    pullRequests: rawData.pullRequests,
    issues: rawData.issues,
  });
  payload.consistency = consistencyResult;

  const insights = evaluateInsightsFromPayload(
    {
      raw: {
        commits: rawData.commits,
        pullRequests: rawData.pullRequests,
        issues: rawData.issues,
        repositories: rawData.repositories,
        timeline: payload.timeline,
        languages: payload.languages,
        focus: payload.focus,
        consistency: payload.consistency,
        repoHealth: payload.repoHealth,
      },
      previous: payload.previous,
    },
    range,
    normalizedAnchor,
    rawData.repositories
  );

  const generatedAt = new Date();
  await Promise.all([
    persistActivityBuckets(userId, range, payload.timeline, rawData, effectiveGranularity(range)),
    persistInsights(userId, range, insights, generatedAt),
  ]);

  return {
    kpis: {
      totalCommits: rawData.commits.length,
      totalPRs: rawData.pullRequests.length,
      totalIssues: rawData.issues.length,
      activeDays: payload.consistency.activeDays,
      currentStreak: payload.consistency.currentStreak,
      longestStreak: payload.consistency.longestStreak,
      repoCount: rawData.repositories.length,
    },
    buckets: payload.timeline,
    languages: payload.languages,
    focus: payload.focus,
    consistency: payload.consistency,
    deltas: payload.deltas,
    repoHealth: payload.repoHealth,
    insights,
  };
}

module.exports = {
  composeIntelligence,
  recomputeIntelligence,
  effectiveGranularity,
  RANGES,
};
