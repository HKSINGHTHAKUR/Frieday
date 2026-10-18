/**
 * Issues fetcher (T2.2).
 *
 * Fetches issues for a repository with pagination, state filtering,
 * and per-repo sync caps.
 *
 * Note: GitHub's issues endpoint includes pull requests by default.
 * Use `filter` parameter or check `pull_request` field to distinguish.
 *
 * Returns DTOs ready for normalization layer.
 */

const { createGithubClient } = require('./githubClient');
const {
  fetcherErrorFor,
  collectPageItems,
  createCursor,
  getSyncCaps,
  createProvenance,
  isNotModified,
  nextPageFromLink,
  safeGet,
  truncate,
  normalizeGitHubUser,
} = require('./fetcherUtils');

const DEFAULT_PER_PAGE = 100;
const VALID_STATES = ['open', 'closed', 'all'];
const VALID_FILTERS = ['assigned', 'created', 'mentioned', 'subscribed', 'all'];

/**
 * Check if a GitHub issue object is actually a pull request.
 * @param {object} issue - Raw issue from GitHub API
 * @returns {boolean}
 */
function isPullRequest(issue) {
  return !!safeGet(issue, 'pull_request');
}

/**
 * Normalize a raw GitHub issue object to a DTO.
 * Handles missing/optional fields defensively.
 * Skips pull requests (they're fetched separately via pulls.fetcher).
 * @param {object} issue - Raw issue from GitHub API
 * @param {string} repoId - Repository ID (MongoDB ObjectId as string)
 * @param {object} provenance - Provenance metadata
 * @returns {object|null} Normalized issue DTO or null if it's a PR
 */
function normalizeIssue(issue, repoId, provenance) {
  // Skip pull requests - they're handled by pulls.fetcher
  if (isPullRequest(issue)) {
    return null;
  }

  const user = safeGet(issue, 'user');
  const assignees = Array.isArray(safeGet(issue, 'assignees'))
    ? safeGet(issue, 'assignees')
        .map((a) => normalizeGitHubUser(a))
        .filter(Boolean)
    : [];

  const labels = Array.isArray(safeGet(issue, 'labels'))
    ? safeGet(issue, 'labels')
        .map((l) => ({
          name: safeGet(l, 'name'),
          color: safeGet(l, 'color'),
          description: safeGet(l, 'description'),
        }))
        .filter(Boolean)
    : [];

  return {
    number: safeGet(issue, 'number'),
    repoId,
    state: safeGet(issue, 'state'),
    title: truncate(safeGet(issue, 'title'), 200),
    body: truncate(safeGet(issue, 'body'), 500),
    createdAt: safeGet(issue, 'created_at') ? new Date(safeGet(issue, 'created_at')) : null,
    updatedAt: safeGet(issue, 'updated_at') ? new Date(safeGet(issue, 'updated_at')) : null,
    closedAt: safeGet(issue, 'closed_at') ? new Date(safeGet(issue, 'closed_at')) : null,
    author: normalizeGitHubUser(user),
    authorAssociation: safeGet(issue, 'author_association'),
    assignees,
    labels,
    comments: safeGet(issue, 'comments', 0),
    locked: Boolean(safeGet(issue, 'locked')),
    milestone: safeGet(issue, 'milestone')
      ? {
          number: safeGet(issue, 'milestone.number'),
          title: safeGet(issue, 'milestone.title'),
          state: safeGet(issue, 'milestone.state'),
          dueOn: safeGet(issue, 'milestone.due_on') ? new Date(safeGet(issue, 'milestone.due_on')) : null,
        }
      : null,
    ...provenance,
  };
}

/**
 * Build request parameters for issue listing.
 * @param {object} options - Request options
 * @param {number} options.perPage - Items per page
 * @param {number} options.page - Page number
 * @param {string} options.state - State filter (open, closed, all)
 * @param {string} options.filter - Filter (assigned, created, mentioned, subscribed, all)
 * @param {string} options.sort - Sort field (created, updated, comments)
 * @param {string} options.direction - Sort direction (asc, desc)
 * @param {string} options.labels - Comma-separated label names
 * @param {string} options.since - ISO timestamp for incremental sync
 * @returns {object} Octokit request parameters
 */
function buildIssueParams({
  perPage = DEFAULT_PER_PAGE,
  page = 1,
  state = 'all',
  filter = 'all',
  sort = 'updated',
  direction = 'desc',
  labels,
  since,
  etag,
} = {}) {
  if (!VALID_STATES.includes(state)) {
    throw new Error(`Invalid issue state: ${state}. Must be one of: ${VALID_STATES.join(', ')}`);
  }
  if (!VALID_FILTERS.includes(filter)) {
    throw new Error(`Invalid issue filter: ${filter}. Must be one of: ${VALID_FILTERS.join(', ')}`);
  }
  const params = {
    per_page: Math.min(perPage, 100),
    page,
    state,
    filter,
    sort,
    direction,
  };
  if (labels) params.labels = labels;
  if (since) params.since = since;
  if (etag) params.headers = { 'If-None-Match': etag };
  return params;
}

/**
 * Fetch all issues for a repository, respecting caps and cursors.
 * Automatically filters out pull requests (handled by pulls.fetcher).
 *
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} repoId - MongoDB repository ID (string)
 * @param {object} options - Fetch options
 * @param {object} options.cursor - Cursor from SyncState (page, etag, since)
 * @param {number} options.maxIssues - Maximum issues to fetch (overrides env cap)
 * @param {string} options.state - State filter (open, closed, all)
 * @param {object} options.deps - Test dependencies
 * @returns {Promise<{ issues: Array, cursor: object, capReached: boolean, notModified: boolean }>}
 */
async function fetchIssues(
  userDoc,
  owner,
  repo,
  repoId,
  { cursor = null, maxIssues = null, state = 'all', deps = {} } = {}
) {
  const caps = getSyncCaps();
  const limit = maxIssues ?? caps.maxIssuesPerRepo;
  const client = deps.client ?? createGithubClient(userDoc, deps);

  let page = cursor?.page ?? 1;
  const etag = cursor?.etag ?? null;
  const since = cursor?.since ?? null;
  const issues = [];

  try {
    for (;;) {
      if (issues.length >= limit) {
        return { issues, cursor: createCursor({ page, since }), capReached: true, notModified: false };
      }

      const params = buildIssueParams({ perPage: DEFAULT_PER_PAGE, page, state, since, etag });
      const { data: response, headers } = await client.requestWithHeaders(
        'GET /repos/{owner}/{repo}/issues',
        { owner, repo, ...params }
      );

      const pageIssues = Array.isArray(response) ? response : [];

      if (pageIssues.length === 0) {
        return {
          issues,
          cursor: createCursor({ page: page + 1, since }),
          capReached: false,
          notModified: false,
        };
      }

      const provenance = createProvenance('rest');
      // PR entries map to null and are skipped without counting (the pulls
      // fetcher owns them).
      const truncated = collectPageItems(pageIssues, issues, limit, (issue) =>
        normalizeIssue(issue, repoId, provenance)
      );
      if (truncated) {
        return { issues, cursor: createCursor({ page, since }), capReached: true, notModified: false };
      }

      // Follow GitHub's Link header when present; otherwise stop on a short
      // page. nextPageFromLink only returns strictly advancing pages.
      const linked = nextPageFromLink(headers, page);
      if (linked !== null) {
        page = linked;
        continue;
      }
      if (pageIssues.length < DEFAULT_PER_PAGE) {
        return {
          issues,
          cursor: createCursor({ page: page + 1, since }),
          capReached: false,
          notModified: false,
        };
      }

      page += 1;
    }
  } catch (err) {
    // 304 Not Modified (Octokit throws; githubClient passes it through raw
    // because it is not an error status): nothing changed, keep cached data.
    if (isNotModified(err?.status)) {
      return { issues, cursor, capReached: false, notModified: true };
    }
    if (err instanceof Error && err.code) {
      throw err;
    }
    throw fetcherErrorFor(500, {
      message: err.message,
      details: { originalError: err.name },
      retryable: true,
    });
  }
}

/**
 * Fetch a single issue by number.
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} number - Issue number
 * @param {string} repoId - MongoDB repository ID
 * @param {object} deps - Test dependencies
 * @returns {Promise<object|null>} Normalized issue DTO or null if not found/PR
 */
async function fetchIssue(userDoc, owner, repo, number, repoId, deps = {}) {
  const client = deps.client ?? createGithubClient(userDoc, deps);
  try {
    const response = await client.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
      owner,
      repo,
      issue_number: number,
    });
    return normalizeIssue(response, repoId, createProvenance('rest'));
  } catch (err) {
    if (err.status === 404 || err.code === 'NOT_FOUND') {
      return null;
    }
    // Typed errors pass through; raw transport failures are wrapped so
    // callers always see code+retryable.
    if (err instanceof Error && err.code) {
      throw err;
    }
    throw fetcherErrorFor(500, {
      message: err.message,
      details: { originalError: err.name },
      retryable: true,
    });
  }
}

/**
 * Fetch issues for multiple repositories. One repository failing does not
 * abort the others: per-repo failures are collected in `errors` while
 * successful results are kept.
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {Array} repositories - Array of { owner, name, repoId }
 * @param {object} options - Fetch options (passed to each fetchIssues call)
 * @param {(info: { key: string, index: number, total: number, cursor: object }) => void} [options.onProgress]
 *   Optional per-repository completion callback (T2.3: progress + checkpoints).
 *   Failures inside the callback propagate (they indicate a broken observer).
 * @returns {Promise<{ issues: Array, cursors: Map, capReached: boolean, errors: Map }>}
 */
async function fetchIssuesForRepositories(userDoc, repositories, options = {}) {
  const { onProgress = null, ...singleOptions } = options;
  const allIssues = [];
  const cursors = new Map();
  const errors = new Map();
  let anyCapReached = false;

  let index = 0;
  for (const repo of repositories) {
    const key = `${repo.owner}/${repo.name}`;
    try {
      const { issues, cursor, capReached } = await fetchIssues(userDoc, repo.owner, repo.name, repo.repoId, {
        ...singleOptions,
        cursor: options.cursors?.get(key),
      });
      allIssues.push(...issues);
      cursors.set(key, cursor);
      if (capReached) anyCapReached = true;
      if (onProgress) await onProgress({ key, index, total: repositories.length, cursor });
    } catch (err) {
      errors.set(key, { message: err.message, code: err.code, status: err.status });
    }
    index += 1;
  }

  return { issues: allIssues, cursors, capReached: anyCapReached, errors };
}

module.exports = {
  fetchIssues,
  fetchIssuesForRepositories,
  fetchIssue,
  normalizeIssue,
  buildIssueParams,
  isPullRequest,
  VALID_STATES,
  VALID_FILTERS,
  DEFAULT_PER_PAGE,
};
