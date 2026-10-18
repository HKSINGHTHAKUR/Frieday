/**
 * Repository health classification (T4.2) — pure function for repo health status.
 *
 * Health rules (PRD §18 item 6):
 *   Active   ≤ 7 days since last activity
 *   Steady   ≤ 30 days since last activity
 *   Quiet    ≤ 60 days since last activity
 *   Stalled  > 60 days since last activity
 *
 * Reference date semantics: uses the provided anchor date (typically the
 * range anchor or latest sync timestamp). No wall-clock dependency.
 *
 * Includes open PR and issue counts per repo.
 *
 * Pure: no I/O, no wall-clock, no randomness, no mutation of inputs.
 */

const REPO_HEALTH_VERSION = 1;

const HEALTH_LABELS = {
  ACTIVE: 'active',
  STEADY: 'steady',
  QUIET: 'quiet',
  STALLED: 'stalled',
};

const HEALTH_THRESHOLDS = {
  [HEALTH_LABELS.ACTIVE]: 7, // ≤ 7 days
  [HEALTH_LABELS.STEADY]: 30, // ≤ 30 days
  [HEALTH_LABELS.QUIET]: 60, // ≤ 60 days
  // STALLED is > 60 days
};

/**
 * Classify a single repository's health based on days since last activity.
 *
 * @param {number} daysSinceActivity - days since last activity (can be fractional)
 * @returns {string} one of 'active', 'steady', 'quiet', 'stalled'
 */
function classifyHealth(daysSinceActivity) {
  if (!Number.isFinite(daysSinceActivity) || daysSinceActivity < 0) {
    // No activity data -> treat as stalled
    return HEALTH_LABELS.STALLED;
  }

  if (daysSinceActivity <= HEALTH_THRESHOLDS[HEALTH_LABELS.ACTIVE]) {
    return HEALTH_LABELS.ACTIVE;
  }
  if (daysSinceActivity <= HEALTH_THRESHOLDS[HEALTH_LABELS.STEADY]) {
    return HEALTH_LABELS.STEADY;
  }
  if (daysSinceActivity <= HEALTH_THRESHOLDS[HEALTH_LABELS.QUIET]) {
    return HEALTH_LABELS.QUIET;
  }
  return HEALTH_LABELS.STALLED;
}

/**
 * Compute days between two dates (anchor - lastActivity), in days.
 * Result can be fractional. Uses UTC day boundaries for consistency.
 *
 * @param {Date} anchor - reference date (UTC)
 * @param {Date} lastActivity - last activity date (UTC)
 * @returns {number} days difference (can be fractional)
 */
function daysSince(anchor, lastActivity) {
  if (!anchor || !lastActivity) return Infinity;
  const anchorDay = new Date(anchor);
  anchorDay.setUTCHours(0, 0, 0, 0);
  const activityDay = new Date(lastActivity);
  activityDay.setUTCHours(0, 0, 0, 0);
  return (anchorDay - activityDay) / (24 * 60 * 60 * 1000);
}

/**
 * Determine the most recent activity date for a repository from its events.
 *
 * @param {Object} opts
 * @param {Array} opts.commits - Commit docs with authoredAt
 * @param {Array} opts.pullRequests - PR docs with createdAt, mergedAt, updatedAt
 * @param {Array} opts.issues - Issue docs with createdAt, updatedAt, closedAt
 * @returns {Date|null} most recent activity date, or null if no activity
 */
function getLatestActivityDate({ commits = [], pullRequests = [], issues = [] } = {}) {
  let latest = null;

  for (const c of commits) {
    if (c.authoredAt && (!latest || c.authoredAt > latest)) latest = c.authoredAt;
  }
  for (const pr of pullRequests) {
    // Consider any PR activity: created, merged, updated
    for (const dt of [pr.createdAt, pr.mergedAt, pr.updatedAt]) {
      if (dt && (!latest || dt > latest)) latest = dt;
    }
  }
  for (const issue of issues) {
    for (const dt of [issue.createdAt, issue.updatedAt, issue.closedAt]) {
      if (dt && (!latest || dt > latest)) latest = dt;
    }
  }

  return latest;
}

/**
 * Count open PRs for a repository.
 * @param {Array} pullRequests - PR docs with state, repoId
 * @param {string|ObjectId} repoId - repository ID
 * @returns {number}
 */
function countOpenPRs(pullRequests, repoId) {
  const repoKey = repoId?.toString?.() ?? String(repoId);
  let count = 0;
  for (const pr of pullRequests) {
    if (pr.repoId && pr.repoId.toString() === repoKey && pr.state === 'open') {
      count++;
    }
  }
  return count;
}

/**
 * Count open issues for a repository.
 * @param {Array} issues - Issue docs with state, repoId
 * @param {string|ObjectId} repoId - repository ID
 * @returns {number}
 */
function countOpenIssues(issues, repoId) {
  const repoKey = repoId?.toString?.() ?? String(repoId);
  let count = 0;
  for (const issue of issues) {
    if (issue.repoId && issue.repoId.toString() === repoKey && issue.state === 'open') {
      count++;
    }
  }
  return count;
}

/**
 * Compute health for a single repository.
 *
 * @param {Object} opts
 * @param {Object} opts.repository - Repository doc with _id, name, owner
 * @param {Date} opts.anchor - reference date (UTC)
 * @param {Array} opts.commits - Commit docs for this repo
 * @param {Array} opts.pullRequests - PR docs for this repo
 * @param {Array} opts.issues - Issue docs for this repo
 * @returns {Object} health result
 */
function computeRepoHealth({ repository, anchor, commits = [], pullRequests = [], issues = [] } = {}) {
  if (!repository || !repository._id) {
    throw new Error('Repository with _id is required');
  }

  const latestActivity = getLatestActivityDate({ commits, pullRequests, issues });
  const days = daysSince(anchor, latestActivity);
  const health = classifyHealth(days);
  const openPRs = countOpenPRs(pullRequests, repository._id);
  const openIssues = countOpenIssues(issues, repository._id);

  return {
    repoId: repository._id.toString(),
    repoName: repository.fullName || `${repository.owner}/${repository.name}`,
    health,
    daysSinceActivity: Number.isFinite(days) ? Math.round(days * 10) / 10 : null,
    lastActivityAt: latestActivity?.toISOString() ?? null,
    openPRs,
    openIssues,
    version: 1,
  };
}

/**
 * Compute health for all repositories.
 *
 * @param {Object} opts
 * @param {Array} opts.repositories - Repository docs
 * @param {Date} opts.anchor - reference date (UTC)
 * @param {Array} opts.commits - all Commit docs
 * @param {Array} opts.pullRequests - all PR docs
 * @param {Array} opts.issues - all Issue docs
 * @returns {Array} health results per repository
 */
function computeAllRepoHealth({
  repositories = [],
  anchor,
  commits = [],
  pullRequests = [],
  issues = [],
} = {}) {
  // Group events by repoId for efficiency
  const commitsByRepo = new Map();
  const prsByRepo = new Map();
  const issuesByRepo = new Map();

  for (const c of commits) {
    if (c.repoId) {
      const key = c.repoId.toString();
      if (!commitsByRepo.has(key)) commitsByRepo.set(key, []);
      commitsByRepo.get(key).push(c);
    }
  }
  for (const pr of pullRequests) {
    if (pr.repoId) {
      const key = pr.repoId.toString();
      if (!prsByRepo.has(key)) prsByRepo.set(key, []);
      prsByRepo.get(key).push(pr);
    }
  }
  for (const issue of issues) {
    if (issue.repoId) {
      const key = issue.repoId.toString();
      if (!issuesByRepo.has(key)) issuesByRepo.set(key, []);
      issuesByRepo.get(key).push(issue);
    }
  }

  const results = [];
  for (const repo of repositories) {
    const repoKey = repo._id.toString();
    const result = computeRepoHealth({
      repository: repo,
      anchor,
      commits: commitsByRepo.get(repoKey) ?? [],
      pullRequests: prsByRepo.get(repoKey) ?? [],
      issues: issuesByRepo.get(repoKey) ?? [],
    });
    results.push(result);
  }

  return results;
}

module.exports = {
  REPO_HEALTH_VERSION,
  HEALTH_LABELS,
  HEALTH_THRESHOLDS,
  classifyHealth,
  daysSince,
  getLatestActivityDate,
  countOpenPRs,
  countOpenIssues,
  computeRepoHealth,
  computeAllRepoHealth,
};
