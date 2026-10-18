/**
 * Repository controller (T5.1) — HTTP handlers for repository endpoints.
 */

const mongoose = require('mongoose');
const { STATUS_BY_CODE } = require('../../middleware/errorHandler');
const { decodeCursor, buildCursorFilter, buildSort, encodeCursor } = require('../../utils/pagination');
const { getRepoHealthForIds, getRecentActivity, getMiniTimeline } = require('./repos.service');
const Repository = require('../../models/Repository');

function sendError(req, res, err) {
  const code = err && typeof err.code === 'string' && STATUS_BY_CODE[err.code] ? err.code : 'INTERNAL';
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  if (code === 'INTERNAL') {
    // err.message may embed driver/connection details — safe metadata only.
    req.log.error({ reqId: req.id, code, operation: 'repos' });
  } else {
    req.log.warn({ reqId: req.id, code, operation: 'repos' });
  }
  // INTERNAL hides the message (it may carry driver details); known codes
  // carry messages our own layers wrote (verified secret-free).
  const message = code === 'INTERNAL' ? 'Something went wrong.' : err.message;
  return res
    .status(status)
    .json({ error: { code, message, details: err.details, retryable: Boolean(err.retryable) } });
}

/**
 * GET /api/repos
 * List repositories with cursor pagination.
 */
async function listReposHandler(req, res) {
  const { sort: sortParam, limit, cursor } = req.query;
  const userId = req.user.id;

  try {
    const cursorData = validateAndDecodeCursor(cursor);
    if (cursor && !cursorData) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid cursor.', retryable: false },
      });
    }

    const baseQuery = buildBaseQuery(userId);
    const sortOrder = buildRepoSort(sortParam);
    const cursorFilter = buildCursorFilter(decodeCursor(cursor));

    const repos = await fetchRepos(baseQuery, cursorFilter, limit, sortOrder);
    const { repos: trimmedRepos, nextCursor } = buildPaginatedResponse(repos, limit);
    const repoHealthMap = await getRepoHealthForIds(
      userId,
      trimmedRepos.map((r) => r._id.toString())
    );
    const items = buildRepoItems(trimmedRepos, repoHealthMap);

    return res.json({ items, nextCursor, hasMore: !!nextCursor });
  } catch (err) {
    return sendError(req, res, err);
  }
}

function validateAndDecodeCursor(cursor) {
  const cursorData = decodeCursor(cursor);
  if (cursor && !cursorData) {
    return null;
  }
  return cursorData;
}

function buildBaseQuery(userId) {
  return { userId: new mongoose.Types.ObjectId(userId) };
}

function buildRepoSort(sortParam) {
  const sortField = sortParam === 'recent' ? 'githubUpdatedAt' : 'pushedAt';
  return buildSort({ sortField, direction: -1 });
}

async function fetchRepos(baseQuery, cursorFilter, limit, sortOrder) {
  return Repository.find({ ...baseQuery, ...cursorFilter })
    .sort(sortOrder)
    .limit(limit + 1)
    .select(
      'githubId fullName owner name visibility primaryLanguage stars fork pushedAt githubUpdatedAt description'
    )
    .lean();
}

function buildPaginatedResponse(repos, limit) {
  let nextCursor = null;
  if (repos.length > limit) {
    nextCursor = encodeCursor({
      afterId: repos[limit - 1]._id.toString(),
      afterCreatedAt:
        repos[limit - 1].githubUpdatedAt || repos[limit - 1].pushedAt || new Date().toISOString(),
    });
    return { repos: repos.slice(0, limit), nextCursor };
  }
  return { repos, nextCursor: null };
}

function buildRepoItems(repos, repoHealthMap) {
  return repos.map((repo) => {
    const health = repoHealthMap.get(repo._id.toString()) || {
      health: 'stalled',
      daysSinceActivity: null,
      lastActivityAt: null,
      openPRs: 0,
      openIssues: 0,
    };
    return buildRepoItem(repo, health);
  });
}

function buildRepoItem(repo, health) {
  return {
    id: repo._id.toString(),
    githubId: repo.githubId,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    visibility: repo.visibility,
    primaryLanguage: repo.primaryLanguage,
    stars: repo.stars,
    fork: repo.fork,
    pushedAt: repo.pushedAt,
    updatedAt: repo.githubUpdatedAt,
    description: repo.description,
    health: health.health,
    daysSinceActivity: health.daysSinceActivity,
    lastActivityAt: health.lastActivityAt,
    openPRs: health.openPRs,
    openIssues: health.openIssues,
  };
}

/**
 * GET /api/repos/:id
 * Repository detail with paginated items.
 */
async function repoDetailHandler(req, res) {
  const userId = req.user.id;
  const { id } = req.params;
  const { range } = req.query;

  try {
    const repo = await findAndValidateRepo(id, req.user.id);
    if (!repo) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Repository not found.', retryable: false },
      });
    }

    const healthData = await getRepoHealthForSingleRepo(userId, repo);
    const { recentActivity, miniTimeline } = await getRepoActivityAndTimeline(userId, repo._id, range);

    return res.json(buildRepoDetailResponse(repo, healthData, { recentActivity, miniTimeline }));
  } catch (err) {
    return sendError(req, res, err);
  }
}

async function findAndValidateRepo(id, userId) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }
  return Repository.findOne({
    _id: new mongoose.Types.ObjectId(id),
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();
}

async function getRepoHealthForSingleRepo(userId, repo) {
  const health = await getRepoHealthForIds(userId, [repo._id.toString()]);
  return (
    health.get(repo._id.toString()) || {
      health: 'stalled',
      daysSinceActivity: null,
      lastActivityAt: null,
      openPRs: 0,
      openIssues: 0,
    }
  );
}

async function getRepoActivityAndTimeline(userId, repoId, range) {
  const recentActivity = await getRecentActivity(userId, repoId, range);
  const miniTimeline = await getMiniTimeline(userId, repoId, range);
  return { recentActivity, miniTimeline };
}

function buildRepoDetailResponse(repo, healthData, { recentActivity, miniTimeline }) {
  return {
    id: repo._id.toString(),
    githubId: repo.githubId,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    visibility: repo.visibility,
    primaryLanguage: repo.primaryLanguage,
    stars: repo.stars,
    fork: repo.fork,
    pushedAt: repo.pushedAt,
    updatedAt: repo.githubUpdatedAt,
    description: repo.description,
    htmlUrl: repo.htmlUrl,
    health: healthData.health,
    daysSinceActivity: healthData.daysSinceActivity,
    lastActivityAt: healthData.lastActivityAt,
    openPRs: healthData.openPRs,
    openIssues: healthData.openIssues,
    recentActivity,
    miniTimeline,
  };
}
module.exports = {
  listReposHandler,
  repoDetailHandler,
};
