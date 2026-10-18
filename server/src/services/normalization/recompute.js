/**
 * Recompute trigger hook (T3.2).
 *
 * The orchestrator calls this after a sync run persists fresh raw data so
 * derived collections (ActivityBucket, Insight) can be rebuilt. The actual
 * recompute implementation belongs to Phase 4 (intelligence engine): until
 * then this is a documented no-op that resolves a stable "not accepted"
 * shape instead of failing the sync. It must never throw, never compute,
 * and never touch the database.
 */
async function requestRecompute(userId, context = {}) {
  void userId;
  void context;
  return { accepted: false, reason: 'phase-4-not-implemented' };
}

module.exports = { requestRecompute };
