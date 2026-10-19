/**
 * Composer persistence (T4.3) - ActivityBucket and Insight persistence
 */

const mongoose = require('mongoose');
const ActivityBucket = require('../../models/ActivityBucket');
const Insight = require('../../models/Insight');

/**
 * Compute and persist per-repo ActivityBuckets for a given range + granularity.
 * NOTE: does not wipe; callers wipe the range first (see persistActivityBuckets).
 */
async function persistPerRepoActivityBuckets(userId, range, rawData, granularity = null) {
  if (!rawData || !rawData.commits || !rawData.pullRequests || !rawData.issues) {
    return;
  }

  // Collect all repoIds from the raw data
  const repoIds = [
    ...new Set([
      ...rawData.commits.map((c) => c.repoId?.toString()).filter(Boolean),
      ...rawData.pullRequests.map((pr) => pr.repoId?.toString()).filter(Boolean),
      ...rawData.issues.map((i) => i.repoId?.toString()).filter(Boolean),
    ]),
  ];

  for (const repoId of repoIds) {
    // Filter raw data for this repo (inline in computeTimeline call)
    if (
      !rawData.commits.filter((c) => c.repoId?.toString() === repoId).length &&
      !rawData.pullRequests.filter((pr) => pr.repoId?.toString() === repoId).length &&
      !rawData.issues.filter((i) => i.repoId?.toString() === repoId).length
    ) {
      continue;
    }

    // Compute per-repo timeline for this range + granularity
    const repoTimeline = require('./index').timeline.computeTimeline({
      range,
      anchor: new Date(),
      commits: rawData.commits.filter((c) => c.repoId?.toString() === repoId),
      pullRequests: rawData.pullRequests.filter((pr) => pr.repoId?.toString() === repoId),
      issues: rawData.issues.filter((i) => i.repoId?.toString() === repoId),
      repoFilter: { repoId },
      granularity,
    });

    if (!repoTimeline.length) continue;

    const repoOps = repoTimeline.map((bucket) => ({
      updateOne: {
        filter: {
          userId,
          range,
          granularity: granularity ?? null,
          bucketStart: bucket.bucketStart,
          repoId: new mongoose.Types.ObjectId(repoId),
        },
        update: {
          $set: {
            userId,
            range,
            granularity: granularity ?? null,
            bucketStart: bucket.bucketStart,
            repoId: new mongoose.Types.ObjectId(repoId),
            commits: bucket.commits,
            prsOpened: bucket.prsOpened,
            prsMerged: bucket.prsMerged,
            issuesTouched: bucket.issuesTouched,
          },
        },
        upsert: true,
      },
    }));

    if (repoOps.length) {
      await ActivityBucket.bulkWrite(repoOps, { ordered: false });
    }
  }
}

/**
 * Wipe all ActivityBucket rows for a (user, range) before rebuilding. Derived
 * collections are "recomputed, never hand-edited; recompute wipes and rebuilds"
 * (architecture.md §6). This also clears rows persisted under the pre-granularity
 * schema or at a different granularity, so the granularity-scoped identity is
 * always consistent on the next read.
 * @param {string} userId
 * @param {string} range
 */
async function resetRangeBuckets(userId, range) {
  await ActivityBucket.deleteMany({ userId, range });
}

/**
 * Persist ActivityBucket documents from timeline output.
 * Wipes the range first (architecture.md §6 recompute semantics), then upserts
 * aggregate + per-repo buckets at the requested granularity.
 */
async function persistActivityBuckets(userId, range, timeline, rawData, granularity = null) {
  // Wipe-and-rebuild: remove every bucket for this range (all granularities,
  // aggregate + per-repo) so stale rows never collide with the new identity.
  await resetRangeBuckets(userId, range);

  // 1. Persist aggregate buckets (repoId: null)
  const aggregateOps = timeline.map((bucket) => ({
    updateOne: {
      filter: {
        userId,
        range,
        granularity: granularity ?? null,
        bucketStart: bucket.bucketStart,
        repoId: null, // aggregate buckets only
      },
      update: {
        $set: {
          userId,
          range,
          granularity: granularity ?? null,
          bucketStart: bucket.bucketStart,
          repoId: null,
          commits: bucket.commits,
          prsOpened: bucket.prsOpened,
          prsMerged: bucket.prsMerged,
          issuesTouched: bucket.issuesTouched,
        },
      },
      upsert: true,
    },
  }));

  if (aggregateOps.length) {
    await ActivityBucket.bulkWrite(aggregateOps, { ordered: false });
  }

  // 2. Persist per-repo ActivityBuckets
  await persistPerRepoActivityBuckets(userId, range, rawData, granularity);
}

/**
 * Persist Insight documents.
 * Uses upsert with unique index on (userId, range, templateId, repoId).
 * repoId is extracted from insight.metrics.repoId for per-repo templates
 * (e.g. project_health); null for aggregate templates. This preserves all
 * per-repo project_health insights instead of collapsing them to one doc.
 * generatedAt is updated as provenance but is NOT part of the upsert identity.
 */
async function persistInsights(userId, range, insights, generatedAt) {
  if (!insights.length) return;

  // Wipe-and-rebuild: remove all existing insights for this user/range so
  // per-repo insights (e.g. project_health) can be re-inserted without
  // unique-index collisions on (userId, range, templateId). Matches the
  // wipe-and-rebuild pattern used by persistActivityBuckets.
  await Insight.deleteMany({ userId, range });

  const operations = insights.map((insight) => {
    const repoId = insight.metrics?.repoId ? new mongoose.Types.ObjectId(insight.metrics.repoId) : null;
    return {
      updateOne: {
        filter: {
          userId,
          range,
          templateId: insight.templateId,
          repoId,
        },
        update: {
          $set: {
            userId,
            range,
            templateId: insight.templateId,
            repoId,
            generatedAt,
            title: insight.title,
            text: insight.text,
            metrics: insight.metrics,
            evidence: insight.evidence,
            confidence: insight.confidence,
          },
        },
        upsert: true,
      },
    };
  });

  await Insight.bulkWrite(operations, { ordered: false });
}

module.exports = {
  persistActivityBuckets,
  persistPerRepoActivityBuckets,
  resetRangeBuckets,
  persistInsights,
};
