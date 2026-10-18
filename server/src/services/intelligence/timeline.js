/**
 * Timeline aggregation (T4.1) — pure function for bucketing activity.
 *
 * Input: arrays of raw documents (Commit, PullRequest, Issue) with
 * `authoredAt` / `createdAt` / `mergedAt` / `updatedAt` timestamps.
 * Output: array of bucket objects sorted by bucketStart ascending:
 *   { bucketStart, commits, prsOpened, prsMerged, issuesTouched }
 *
 * Bucketing:
 * - 30d range -> daily buckets (UTC day boundaries)
 * - 90d/12m range -> weekly buckets (Monday-based, UTC)
 *
 * Pure: no I/O, no mutation, no wall-clock, no randomness.
 */

const {
  dayStartUTC,
  dayBucketKey,
  weekBucketKey,
  iterDayBuckets,
  iterWeekBuckets,
  dayKeyToDate,
  weekKeyToDate,
} = require('../../utils/dates');

const RANGES = ['30d', '90d', '12m'];

/**
 * Compute the range start date (UTC midnight) for a given range string.
 * @param {string} range - '30d', '90d', or '12m'
 * @param {Date} [anchor] - optional anchor date (default: now, but tests inject)
 * @returns {Date} range start at UTC midnight
 */
function rangeStart(range, anchor = new Date()) {
  const d = dayStartUTC(anchor);
  switch (range) {
    case '30d':
      d.setUTCDate(d.getUTCDate() - 29); // inclusive of today = 30 days
      break;
    case '90d':
      d.setUTCDate(d.getUTCDate() - 89);
      break;
    case '12m': {
      // 12 months = 11 months before anchor's month, first day of that month
      const anchorYear = d.getUTCFullYear();
      const anchorMonth = d.getUTCMonth();
      let month = anchorMonth - 11;
      let year = anchorYear;
      if (month < 0) {
        month += 12;
        year -= 1;
      }
      // Create new date at first of target month
      return new Date(Date.UTC(year, month, 1));
    }
    default:
      throw new Error(`Invalid range: ${range}. Must be one of ${RANGES.join(', ')}`);
  }
  return d;
}

/**
 * Determine bucket type for a range.
 * @param {string} range
 * @returns {'day'|'week'}
 */
function bucketTypeForRange(range) {
  return range === '30d' ? 'day' : 'week';
}

/**
 * Get the bucket key for a timestamp according to the range's bucket type.
 * @param {Date} timestamp
 * @param {string} range
 * @returns {string} bucket key
 */
function bucketKeyFor(timestamp, range) {
  return range === '30d' ? dayBucketKey(timestamp) : weekBucketKey(timestamp);
}

/**
 * Get the bucket start Date for a bucket key and granularity.
 * Uses the effective granularity (not the range) so an explicit day/week
 * override decodes correctly (prd.md §9 F4: 30d=day, 90d/12m=week default,
 * override allowed).
 * @param {string} key
 * @param {string} range
 * @param {string} [granularity] - 'day' | 'week' (defaults to range type)
 * @returns {Date}
 */
function bucketStartFor(key, range, granularity) {
  const type = granularity || bucketTypeForRange(range);
  return type === 'day' ? dayKeyToDate(key) : weekKeyToDate(key);
}

/**
 * Timeline aggregation main entry point.
 *
 * @param {Object} opts
 * @param {string} opts.range - '30d', '90d', or '12m'
 * @param {Date} opts.anchor - anchor date for range calculation (tests inject)
 * @param {Array} opts.commits - Commit docs with authoredAt
 * @param {Array} opts.pullRequests - PR docs with createdAt, mergedAt
 * @param {Array} opts.issues - Issue docs with createdAt, updatedAt
 * @param {Object} [opts.repoFilter] - optional { repoId } to filter by repo
 * @returns {Array} sorted buckets: { bucketStart, commits, prsOpened, prsMerged, issuesTouched }
 */
/**
 * Compute timeline aggregation.
 *
 * @param {Object} opts
 * @param {string} opts.range - '30d', '90d', or '12m'
 * @param {Date} opts.anchor - anchor date for range calculation (tests inject)
 * @param {Array} opts.commits - Commit docs with authoredAt
 * @param {Array} opts.pullRequests - PR docs with createdAt, mergedAt
 * @param {Array} opts.issues - Issue docs with createdAt, updatedAt
 * @param {Object} [opts.repoFilter] - optional { repoId } to filter by repo
 * @param {string} [opts.granularity] - 'day' or 'week' (defaults based on range)
 * @returns {Array} sorted buckets: { bucketStart, commits, prsOpened, prsMerged, issuesTouched }
 */
function computeTimeline({
  range,
  anchor,
  commits = [],
  pullRequests = [],
  issues = [],
  repoFilter = null,
  granularity = null,
} = {}) {
  if (!RANGES.includes(range)) {
    throw new Error(`Invalid range: ${range}. Must be one of ${RANGES.join(', ')}`);
  }

  if (granularity && !['day', 'week'].includes(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}. Must be one of: day, week`);
  }

  const start = rangeStart(range, anchor);
  const end = dayStartUTC(anchor); // today at UTC midnight

  // Determine bucket type: use explicit granularity if provided, else default based on range
  const effectiveGranularity = granularity || bucketTypeForRange(range);
  const iterator = effectiveGranularity === 'week' ? iterWeekBuckets : iterDayBuckets;
  const keyFn = effectiveGranularity === 'week' ? weekBucketKey : dayBucketKey;
  const startKey = keyFn(start);
  const endKey = keyFn(end);

  // Initialize all buckets in range with zero counts
  const buckets = new Map();
  for (const key of iterator(start, end)) {
    buckets.set(key, {
      bucketStart: bucketStartFor(key, range, effectiveGranularity),
      commits: 0,
      prsOpened: 0,
      prsMerged: 0,
      issuesTouched: 0,
    });
  }

  // Helper to check repo filter
  const matchesRepo = (doc) =>
    !repoFilter || (doc.repoId && doc.repoId.toString() === repoFilter.repoId.toString());

  // Process commits -> count by authoredAt
  for (const c of commits) {
    if (!c.authoredAt || !matchesRepo(c)) continue;
    const key = keyFn(c.authoredAt);
    if (key < startKey || key > endKey) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.commits += 1;
  }

  // Process pull requests -> prsOpened by createdAt, prsMerged by mergedAt
  for (const pr of pullRequests) {
    if (!matchesRepo(pr)) continue;
    // Opened
    if (pr.createdAt) {
      const key = keyFn(pr.createdAt);
      if (key >= startKey && key <= endKey) {
        const bucket = buckets.get(key);
        if (bucket) bucket.prsOpened += 1;
      }
    }
    // Merged
    if (pr.mergedAt) {
      const key = keyFn(pr.mergedAt);
      if (key >= startKey && key <= endKey) {
        const bucket = buckets.get(key);
        if (bucket) bucket.prsMerged += 1;
      }
    }
  }

  // Process issues -> issuesTouched by createdAt or updatedAt (whichever is in range)
  // An issue "touches" a bucket if it was created or updated in that bucket.
  // To avoid double-counting same issue in same bucket, track seen per bucket.
  const issueTouchedInBucket = new Map(); // key -> Set(issue number)
  for (const issue of issues) {
    if (!matchesRepo(issue)) continue;
    const issueId = `${issue.repoId}:${issue.number}`;
    // Check createdAt
    if (issue.createdAt) {
      const key = keyFn(issue.createdAt);
      if (key >= startKey && key <= endKey) {
        if (!issueTouchedInBucket.has(key)) issueTouchedInBucket.set(key, new Set());
        if (!issueTouchedInBucket.get(key).has(issueId)) {
          issueTouchedInBucket.get(key).add(issueId);
          const bucket = buckets.get(key);
          if (bucket) bucket.issuesTouched += 1;
        }
      }
    }
    // Check updatedAt (if different from createdAt and in range)
    if (issue.updatedAt && issue.updatedAt.getTime() !== issue.createdAt?.getTime()) {
      const key = keyFn(issue.updatedAt);
      if (key >= startKey && key <= endKey) {
        if (!issueTouchedInBucket.has(key)) issueTouchedInBucket.set(key, new Set());
        if (!issueTouchedInBucket.get(key).has(issueId)) {
          issueTouchedInBucket.get(key).add(issueId);
          const bucket = buckets.get(key);
          if (bucket) bucket.issuesTouched += 1;
        }
      }
    }
  }

  // Convert to sorted array
  const result = [];
  for (const key of iterator(start, end)) {
    const bucket = buckets.get(key);
    result.push({ ...bucket });
  }

  return result;
}

/**
 * Compute timeline for a single repository (convenience wrapper).
 */
function computeRepoTimeline({ range, anchor, commits = [], pullRequests = [], issues = [], repoId } = {}) {
  return computeTimeline({ range, anchor, commits, pullRequests, issues, repoFilter: { repoId } });
}

module.exports = {
  RANGES,
  rangeStart,
  bucketTypeForRange,
  bucketKeyFor,
  bucketStartFor,
  computeTimeline,
  computeRepoTimeline,
};
