/**
 * Composer core utilities (T4.3)
 */

const SyncState = require('../../models/SyncState');
const Insight = require('../../models/Insight');

const RANGES = ['30d', '90d', '12m'];

/**
 * Compute the previous equal-length period anchor for a given range.
 * @param {string} range - '30d', '90d', or '12m'
 * @param {Date} anchor - current period anchor
 * @returns {Date} previous period anchor
 */
function getPreviousAnchor(range, anchor) {
  const d = new Date(anchor);
  switch (range) {
    case '30d':
      d.setUTCDate(d.getUTCDate() - 30);
      break;
    case '90d':
      d.setUTCDate(d.getUTCDate() - 90);
      break;
    case '12m':
      d.setUTCMonth(d.getUTCMonth() - 12);
      break;
    default:
      throw new Error(`Invalid range: ${range}`);
  }
  return d;
}

/**
 * Check if cache is valid by comparing SyncState timestamps.
 * Returns true if all relevant resources have unchanged SyncState since last recompute.
 */
async function isCacheValid(userId, range, lastRecomputeAt) {
  if (!lastRecomputeAt) return false;

  const resources = ['repositories', 'commits', 'pulls', 'issues', 'languages'];
  const states = await SyncState.find({
    userId,
    resource: { $in: resources },
  }).lean();

  for (const state of states) {
    if (state.updatedAt && state.updatedAt > lastRecomputeAt) {
      return false;
    }
    if (state.status !== 'done') {
      return false;
    }
  }

  return true;
}

/**
 * Get the last recompute timestamp from the most recent Insight for this user/range.
 */
async function getLastRecomputeAt(userId, range) {
  const insight = await Insight.findOne({ userId, range })
    .sort({ generatedAt: -1 })
    .select('generatedAt')
    .lean();
  return insight?.generatedAt ?? null;
}

module.exports = {
  RANGES,
  getPreviousAnchor,
  isCacheValid,
  getLastRecomputeAt,
};
