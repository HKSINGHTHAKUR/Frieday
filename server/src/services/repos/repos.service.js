/**
 * Repository service (T5.1) — business logic for repository operations.
 * Pure functions where possible, DB access only.
 */

const mongoose = require('mongoose');
const Repository = require('../../models/Repository');
const Commit = require('../../models/Commit');
const PullRequest = require('../../models/PullRequest');
const Issue = require('../../models/Issue');
const ActivityBucket = require('../../models/ActivityBucket');
const { dayStartUTC } = require('../../utils/dates');

/**
 * Per-repository ceiling for the Phase 10.2 commit-theme analysis.
 *
 * Matches the ingestion cap (SYNC_MAX_COMMITS_PER_REPO, default 500), so the
 * theme view covers every commit the user has ingested for the repositories on
 * the page, while keeping the query provably bounded. Read from the validated
 * env at call time so it can never drift from the ingestion ceiling.
 */
const DEFAULT_MAX_COMMITS_PER_REPO_FOR_THEMES = 500;

function maxCommitsPerRepoForThemes() {
  try {
    const configured = Number(require('../../config/env').getEnv().SYNC_MAX_COMMITS_PER_REPO);
    if (Number.isInteger(configured) && configured > 0) return configured;
  } catch {
    // Env not loaded (unit test context) — fall back to the documented default.
  }
  return DEFAULT_MAX_COMMITS_PER_REPO_FOR_THEMES;
}

/**
 * Get repo health for a list of repo IDs using T4.2 repoHealth.
 *
 * `commitsByRepo` may be supplied by the caller when it has already fetched
 * the (bounded) commit window for these repositories — the health rule only
 * needs each repository's most recent commit date, which the window always
 * contains. Supplying it avoids a second, redundant commits query.
 *
 * @param {string} userId
 * @param {string[]} repoIdStrings
 * @param {Map<string, Array>} [commitsByRepo] pre-fetched commits, grouped by repo id
 */
async function getRepoHealthForIds(userId, repoIdStrings, commitsByRepo = null) {
  if (!repoIdStrings.length) return new Map();

  const repos = await fetchReposByIds(repoIdStrings);
  const commits = commitsByRepo ?? (await getCommitsByRepoIds(userId, repoIdStrings));
  const { pullRequests, issues } = await fetchRepoEvents(userId, repoIdStrings);
  const {
    commitsByRepo: commitsByRepoId,
    prsByRepo,
    issuesByRepo,
  } = groupEventsByRepo(commits, pullRequests, issues);
  const repoMap = buildRepoMap(repos);

  return computeHealthForRepos(repoIdStrings, repoMap, {
    commitsByRepo: commitsByRepoId,
    prsByRepo,
    issuesByRepo,
  });
}

/**
 * Get the user-scoped commits for a list of repo IDs, grouped by repo id.
 *
 * Phase 10.2 (per-repository commit themes) needs the commits for the repos on
 * the current page. The health computation needs the same set, so this helper
 * is the single commit read for the whole list endpoint.
 *
 * The window is PER REPOSITORY, applied inside the pipeline after the
 * grouping. A single global `.limit()` is not equivalent: the busiest
 * repository would consume the entire budget and quiet repositories would
 * silently lose their evidence (their theme chip would disappear entirely).
 * With the per-repository window every repository on the page keeps its own
 * most recent commits, so a quiet repository is never starved by a busy one.
 *
 * Bounded: at most `maxCommitsPerRepoForThemes()` commits per repository on
 * the page are returned — at most 50 x 500 = 25,000 documents for a full page.
 * The ceiling matches the ingestion cap (SYNC_MAX_COMMITS_PER_REPO), so the
 * theme view covers every commit the user has actually ingested for these
 * repositories, while the query stays provably bounded even if the ingested
 * data ever drifts beyond the cap.
 *
 * Deterministic: commits are ordered newest-first, with the commit SHA as a
 * tiebreak. The (userId, sha, repoId) identity index makes that a total
 * order, so the same data always yields the same window.
 *
 * `messageFull` is never read: the projection selects only the four fields
 * the theme classifier and the health rule need.
 *
 * @param {string} userId
 * @param {string[]} repoIdStrings
 * @returns {Promise<Map<string, Array>>} commits grouped by repo id (string keys)
 */
async function getCommitsByRepoIds(userId, repoIdStrings) {
  if (!repoIdStrings.length) return new Map();
  const repoIds = repoIdStrings.map((s) => new mongoose.Types.ObjectId(s));
  const perRepo = maxCommitsPerRepoForThemes();
  const rows = await Commit.aggregate(
    [
      // User-scoped and page-scoped: never another user's commits, never a
      // repository that is not on the current page.
      { $match: { userId: new mongoose.Types.ObjectId(userId), repoId: { $in: repoIds } } },
      // The classifier needs the headline; the health rule needs the date.
      // The commit body is never read.
      { $project: { _id: 0, messageHeadline: 1, sha: 1, repoId: 1, authoredAt: 1 } },
      { $sort: { authoredAt: -1, sha: 1 } },
      { $group: { _id: '$repoId', docs: { $push: '$$ROOT' } } },
      // The per-repository window, applied AFTER the grouping.
      { $project: { docs: { $slice: ['$docs', perRepo] } } },
    ],
    { allowDiskUse: true }
  ).exec();

  const grouped = new Map();
  for (const row of rows) {
    if (!row || !row._id) continue;
    grouped.set(row._id.toString(), Array.isArray(row.docs) ? row.docs : []);
  }
  // `$group` does not guarantee an output order, so the Map's iteration order
  // would otherwise vary between identical calls. Sort by repository id to
  // make the result (and the API payload built from it) byte-for-byte
  // repeatable.
  return new Map([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function fetchReposByIds(repoIdStrings) {
  const repoIds = repoIdStrings.map((s) => new mongoose.Types.ObjectId(s));
  return Repository.find({ _id: { $in: repoIds } }).lean();
}

async function fetchRepoEvents(userId, repoIdStrings) {
  const [pullRequests, issues] = await Promise.all([
    PullRequest.find({
      userId: new mongoose.Types.ObjectId(userId),
      repoId: { $in: repoIdStrings.map((s) => new mongoose.Types.ObjectId(s)) },
    }).lean(),
    Issue.find({
      userId: new mongoose.Types.ObjectId(userId),
      repoId: { $in: repoIdStrings.map((s) => new mongoose.Types.ObjectId(s)) },
    }).lean(),
  ]);
  return { pullRequests, issues };
}

function groupEventsByRepo(commits, pullRequests, issues) {
  const commitsByRepo = new Map();
  const prsByRepo = new Map();
  const issuesByRepo = new Map();

  for (const c of commits) {
    if (!c.repoId) continue;
    const key = c.repoId.toString();
    if (!commitsByRepo.has(key)) commitsByRepo.set(key, []);
    commitsByRepo.get(key).push(c);
  }
  for (const pr of pullRequests) {
    if (!pr.repoId) continue;
    const key = pr.repoId.toString();
    if (!prsByRepo.has(key)) prsByRepo.set(key, []);
    prsByRepo.get(key).push(pr);
  }
  for (const issue of issues) {
    if (!issue.repoId) continue;
    const key = issue.repoId.toString();
    if (!issuesByRepo.has(key)) issuesByRepo.set(key, []);
    issuesByRepo.get(key).push(issue);
  }
  return { commitsByRepo, prsByRepo, issuesByRepo };
}

function buildRepoMap(repos) {
  const repoMap = new Map();
  for (const repo of repos) {
    const key = repo._id.toString();
    repoMap.set(key, {
      _id: repo._id,
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
    });
  }
  return repoMap;
}

async function computeHealthForRepos(repoIdStrings, repoMap, events) {
  const { commitsByRepo, prsByRepo, issuesByRepo } = events;
  const anchor = dayStartUTC(new Date());
  const results = new Map();

  for (const key of repoIdStrings) {
    const repo = repoMap.get(key);
    if (!repo) continue;
    const result = await require('../../services/intelligence/repoHealth').computeRepoHealth({
      repository: { _id: repo._id, fullName: repo.fullName, owner: repo.owner, name: repo.name },
      anchor,
      commits: commitsByRepo.get(key) ?? [],
      pullRequests: prsByRepo.get(key) ?? [],
      issues: issuesByRepo.get(key) ?? [],
    });
    results.set(key, result);
  }
  return results;
}

/**
 * Get recent activity for a repository (commits, PRs, issues).
 *
 * The commit projection is EXPLICIT: only the fields the repository-detail
 * UI renders are read. The commit body (`messageFull`) is never selected, so
 * it cannot reach the response — the endpoint has no contract that requires
 * it, and prd.md §18 states that commit bodies are never exposed. The
 * headline alone is what the activity list shows.
 */
async function getRecentActivity(userId, repoId, range) {
  const anchor = dayStartUTC(new Date());
  const rangeStart = require('../../services/intelligence/timeline').rangeStart(range, anchor);
  const rangeEnd = dayStartUTC(new Date());

  const [commits, pullRequests, issues] = await Promise.all([
    Commit.find({
      userId: new mongoose.Types.ObjectId(userId),
      repoId,
      authoredAt: { $gte: rangeStart, $lte: rangeEnd },
    })
      .select('_id sha messageHeadline authoredAt')
      .sort({ authoredAt: -1 })
      .limit(10)
      .lean(),
    PullRequest.find({
      userId: new mongoose.Types.ObjectId(userId),
      repoId,
      $or: [
        { createdAt: { $gte: rangeStart, $lte: new Date() } },
        { mergedAt: { $gte: rangeStart, $lte: new Date() } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    Issue.find({
      userId: new mongoose.Types.ObjectId(userId),
      repoId,
      $or: [
        { createdAt: { $gte: rangeStart, $lte: new Date() } },
        { updatedAt: { $gte: rangeStart, $lte: new Date() } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  return { commits, pullRequests, issues };
}

/**
 * Get mini timeline (ActivityBucket) for a repository at the requested range.
 * Granularity is derived from the range's canonical semantics (prd.md §18.1:
 * 30d = day, 90d/12m = week) via the shared intelligence helper, so the repo
 * mini timeline never reuses buckets persisted for an incompatible range or
 * granularity. User + repo scoping is enforced on every query.
 * @param {string} userId
 * @param {mongoose.Types.ObjectId} repoId
 * @param {string} range - '30d' | '90d' | '12m'
 */
async function getMiniTimeline(userId, repoId, range) {
  const anchor = dayStartUTC(new Date());
  const bucketRangeStart = require('../../services/intelligence/timeline').rangeStart(range, anchor);
  const granularity = require('../../services/intelligence/timeline').bucketTypeForRange(range);
  const buckets = await ActivityBucket.find({
    userId: new mongoose.Types.ObjectId(userId),
    repoId,
    range,
    granularity,
    bucketStart: { $gte: bucketRangeStart, $lte: dayStartUTC(new Date()) },
  })
    .sort({ bucketStart: 1 })
    .lean();

  return buckets.map((b) => ({
    bucketStart: b.bucketStart,
    commits: b.commits,
    prsOpened: b.prsOpened,
    prsMerged: b.prsMerged,
    issuesTouched: b.issuesTouched,
  }));
}

module.exports = {
  getRepoHealthForIds,
  getCommitsByRepoIds,
  getRecentActivity,
  getMiniTimeline,
};
