/**
 * Consistency calculations (T4.2) — pure functions for active-day detection,
 * streak computation, and gap analysis.
 *
 * Active-day definition (PRD §18 item 4):
 *   A day is "active" if it contains at least one qualifying event:
 *   - Authored commit (authoredAt)
 *   - Merged pull request (mergedAt)
 *   - Qualifying issue event: issue created (createdAt) OR issue closed (closedAt)
 *
 * Streaks are calendar-day based (UTC), not elapsed-millisecond based.
 * Gaps use neutral terminology.
 *
 * Pure: no I/O, no wall-clock, no randomness, no mutation of inputs.
 */

const { dayStartUTC, dayBucketKey, iterDayBuckets } = require('../../utils/dates');

const { computeStreaks, findInternalGaps, classifyGaps } = require('./consistency-streaks');

const ACTIVE_DAY_VERSION = 1;

// Neutral gap language constants
const GAP_LABELS = {
  SHORT: 'gap_short', // 1-3 days
  MEDIUM: 'gap_medium', // 4-7 days
  LONG: 'gap_long', // 8-30 days
  EXTENDED: 'gap_extended', // 31+ days
};

const GAP_LABEL_DISPLAY = {
  [GAP_LABELS.SHORT]: 'Short gap',
  [GAP_LABELS.MEDIUM]: 'Medium gap',
  [GAP_LABELS.LONG]: 'Long gap',
  [GAP_LABELS.EXTENDED]: 'Extended gap',
};

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
      d.setUTCDate(d.getUTCDate() - 29);
      break;
    case '90d':
      d.setUTCDate(d.getUTCDate() - 89);
      break;
    case '12m': {
      const anchorYear = d.getUTCFullYear();
      const anchorMonth = d.getUTCMonth();
      let month = anchorMonth - 11;
      let year = anchorYear;
      if (month < 0) {
        month += 12;
        year -= 1;
      }
      return new Date(Date.UTC(year, month, 1));
    }
    default:
      throw new Error(`Invalid range: ${range}. Must be one of 30d, 90d, 12m`);
  }
  return d;
}

/**
 * Collect all active day keys (YYYY-MM-DD) from the given events.
 * @param {Object} opts
 * @param {Array} opts.commits - Commit docs with authoredAt
 * @param {Array} opts.pullRequests - PR docs with mergedAt
 * @param {Array} opts.issues - Issue docs with createdAt, closedAt
 * @param {string} opts.range - '30d', '90d', or '12m'
 * @param {Date} opts.anchor - anchor date for range calculation
 * @returns {Set<string>} set of active day keys (YYYY-MM-DD)
 */
function collectActiveDayKeys({ commits = [], pullRequests = [], issues = [], range, anchor } = {}) {
  const start = rangeStart(range, anchor);
  const end = dayStartUTC(anchor);
  const startKey = dayBucketKey(start);
  const endKey = dayBucketKey(end);

  const activeKeys = new Set();

  // Commits -> authoredAt
  for (const c of commits) {
    if (!c.authoredAt) continue;
    const key = dayBucketKey(c.authoredAt);
    if (key >= startKey && key <= endKey) activeKeys.add(key);
  }

  // Pull requests -> mergedAt only (qualifying event)
  for (const pr of pullRequests) {
    if (!pr.mergedAt) continue;
    const key = dayBucketKey(pr.mergedAt);
    if (key >= startKey && key <= endKey) activeKeys.add(key);
  }

  // Issues -> createdAt OR closedAt (qualifying issue events)
  for (const issue of issues) {
    if (issue.createdAt) {
      const key = dayBucketKey(issue.createdAt);
      if (key >= startKey && key <= endKey) activeKeys.add(key);
    }
    if (issue.closedAt) {
      const key = dayBucketKey(issue.closedAt);
      if (key >= startKey && key <= endKey) activeKeys.add(key);
    }
  }

  return activeKeys;
}

/**
 * Build streak and gap information from a set of active day keys.
 * @param {Set<string>} activeKeys - set of YYYY-MM-DD keys
 * @param {string} range - '30d', '90d', or '12m'
 * @param {Date} anchor - anchor date
 * @returns {Object} { activeDays, currentStreak, longestStreak, gaps }
 */
function analyzeStreaksAndGaps(activeKeys, range, anchor) {
  const start = rangeStart(range, anchor);
  const end = dayStartUTC(anchor);

  // Convert to sorted array of day keys
  const allKeys = [...iterDayBuckets(start, end)];
  const sortedActive = [...activeKeys].sort();

  if (sortedActive.length === 0) {
    // No active days at all
    const totalDays = allKeys.length;
    return {
      activeDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      gaps:
        totalDays > 0
          ? [
              {
                label: GAP_LABELS.EXTENDED,
                display: GAP_LABEL_DISPLAY[GAP_LABELS.EXTENDED],
                start: allKeys[0],
                end: allKeys[allKeys.length - 1],
                length: totalDays,
              },
            ]
          : [],
    };
  }

  const { longestStreak, currentStreakCount } = computeStreaks(sortedActive, anchor);
  const gaps = findInternalGaps(sortedActive);
  const classifiedGaps = classifyGaps(gaps, GAP_LABELS, GAP_LABEL_DISPLAY);

  return {
    activeDays: sortedActive.length,
    currentStreak: currentStreakCount,
    longestStreak,
    gaps: classifiedGaps,
  };
}

/**
 * Main consistency computation entry point.
 *
 * @param {Object} opts
 * @param {string} opts.range - '30d', '90d', or '12m'
 * @param {Date} opts.anchor - anchor date for range calculation (tests inject)
 * @param {Array} opts.commits - Commit docs with authoredAt
 * @param {Array} opts.pullRequests - PR docs with mergedAt
 * @param {Array} opts.issues - Issue docs with createdAt, closedAt
 * @param {Object} [opts.repoFilter] - optional { repoId } to filter by repo
 * @returns {Object} consistency result
 */
function computeConsistency({
  range,
  anchor,
  commits = [],
  pullRequests = [],
  issues = [],
  repoFilter = null,
} = {}) {
  if (!['30d', '90d', '12m'].includes(range)) {
    throw new Error(`Invalid range: ${range}. Must be one of 30d, 90d, 12m`);
  }

  // Filter by repo if needed
  const filteredCommits = repoFilter
    ? commits.filter((c) => c.repoId && c.repoId.toString() === repoFilter.repoId.toString())
    : commits;
  const filteredPRs = repoFilter
    ? pullRequests.filter((pr) => pr.repoId && pr.repoId.toString() === repoFilter.repoId.toString())
    : pullRequests;
  const filteredIssues = repoFilter
    ? issues.filter((i) => i.repoId && i.repoId.toString() === repoFilter.repoId.toString())
    : issues;

  const activeKeys = collectActiveDayKeys({
    commits: filteredCommits,
    pullRequests: filteredPRs,
    issues: filteredIssues,
    range,
    anchor,
  });

  const analysis = analyzeStreaksAndGaps(activeKeys, range, anchor);

  return {
    version: ACTIVE_DAY_VERSION,
    activeDays: analysis.activeDays,
    currentStreak: analysis.currentStreak,
    longestStreak: analysis.longestStreak,
    gaps: analysis.gaps,
  };
}

/**
 * Compute consistency for a single repository.
 */
function computeRepoConsistency({
  range,
  anchor,
  commits = [],
  pullRequests = [],
  issues = [],
  repoId,
} = {}) {
  return computeConsistency({ range, anchor, commits, pullRequests, issues, repoFilter: { repoId } });
}

module.exports = {
  ACTIVE_DAY_VERSION,
  GAP_LABELS,
  GAP_LABEL_DISPLAY,
  rangeStart,
  collectActiveDayKeys,
  analyzeStreaksAndGaps,
  computeConsistency,
  computeRepoConsistency,
};
