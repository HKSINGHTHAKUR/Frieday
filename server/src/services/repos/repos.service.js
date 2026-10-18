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
 * Get repo health for a list of repo IDs using T4.2 repoHealth.
 */
async function getRepoHealthForIds(userId, repoIdStrings) {
  if (!repoIdStrings.length) return new Map();

  const repos = await fetchReposByIds(repoIdStrings);
  const repoEvents = await fetchRepoEvents(userId, repoIdStrings);
  const { commitsByRepo, prsByRepo, issuesByRepo } = groupEventsByRepo(
    repoEvents.commits,
    repoEvents.pullRequests,
    repoEvents.issues
  );
  const repoMap = buildRepoMap(repos);

  return computeHealthForRepos(repoIdStrings, repoMap, { commitsByRepo, prsByRepo, issuesByRepo });
}

async function fetchReposByIds(repoIdStrings) {
  const repoIds = repoIdStrings.map((s) => new mongoose.Types.ObjectId(s));
  return Repository.find({ _id: { $in: repoIds } }).lean();
}

async function fetchRepoEvents(userId, repoIdStrings) {
  const [commits, pullRequests, issues] = await Promise.all([
    Commit.find({
      userId: new mongoose.Types.ObjectId(userId),
      repoId: { $in: repoIdStrings.map((s) => new mongoose.Types.ObjectId(s)) },
    }).lean(),
    PullRequest.find({
      userId: new mongoose.Types.ObjectId(userId),
      repoId: { $in: repoIdStrings.map((s) => new mongoose.Types.ObjectId(s)) },
    }).lean(),
    Issue.find({
      userId: new mongoose.Types.ObjectId(userId),
      repoId: { $in: repoIdStrings.map((s) => new mongoose.Types.ObjectId(s)) },
    }).lean(),
  ]);
  return { commits, pullRequests, issues };
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
  getRecentActivity,
  getMiniTimeline,
};
