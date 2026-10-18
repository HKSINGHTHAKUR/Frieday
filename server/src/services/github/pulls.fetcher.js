/**
 * Pull Requests fetcher (T2.2).
 *
 * Fetches pull requests for a repository with pagination, state filtering,
 * and per-repo sync caps.
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

/**
 * Normalize a raw GitHub pull request object to a DTO.
 * Handles missing/optional fields defensively.
 * @param {object} pr - Raw pull request from GitHub API
 * @param {string} repoId - Repository ID (MongoDB ObjectId as string)
 * @param {object} provenance - Provenance metadata
 * @returns {object} Normalized PR DTO
 */
/**
 * Normalize the base/head ref portion of a pull request.
 * @param {object} pr - Raw pull request from GitHub API
 * @returns {{ baseRef: string|null, baseSha: string|null, baseRepo: object|null, headRef: string|null, headSha: string|null, headRepo: object|null }}
 */
function normalizePullRefs(pr) {
  const base = safeGet(pr, 'base');
  const head = safeGet(pr, 'head');
  const baseRepo = safeGet(base, 'repo');
  const headRepo = safeGet(head, 'repo');
  const slimRepo = (repo) =>
    repo ? { id: safeGet(repo, 'id'), fullName: safeGet(repo, 'full_name') } : null;
  return {
    baseRef: safeGet(base, 'ref'),
    baseSha: safeGet(base, 'sha'),
    baseRepo: slimRepo(baseRepo),
    headRef: safeGet(head, 'ref'),
    headSha: safeGet(head, 'sha'),
    headRepo: slimRepo(headRepo),
  };
}

function normalizePullRequest(pr, repoId, provenance) {
  const user = safeGet(pr, 'user');

  const requestedReviewers = Array.isArray(safeGet(pr, 'requested_reviewers'))
    ? safeGet(pr, 'requested_reviewers')
        .map((r) => normalizeGitHubUser(r))
        .filter(Boolean)
    : [];

  const reviewers = Array.isArray(safeGet(pr, 'reviewers'))
    ? safeGet(pr, 'reviewers')
        .map((r) => normalizeGitHubUser(r))
        .filter(Boolean)
    : [];

  return {
    number: safeGet(pr, 'number'),
    repoId,
    state: safeGet(pr, 'state'),
    title: truncate(safeGet(pr, 'title'), 200),
    body: truncate(safeGet(pr, 'body'), 500),
    createdAt: safeGet(pr, 'created_at') ? new Date(safeGet(pr, 'created_at')) : null,
    updatedAt: safeGet(pr, 'updated_at') ? new Date(safeGet(pr, 'updated_at')) : null,
    closedAt: safeGet(pr, 'closed_at') ? new Date(safeGet(pr, 'closed_at')) : null,
    mergedAt: safeGet(pr, 'merged_at') ? new Date(safeGet(pr, 'merged_at')) : null,
    author: normalizeGitHubUser(user),
    authorAssociation: safeGet(pr, 'author_association'),
    draft: Boolean(safeGet(pr, 'draft')),
    additions: safeGet(pr, 'additions', 0),
    deletions: safeGet(pr, 'deletions', 0),
    changedFiles: safeGet(pr, 'changed_files', 0),
    commits: safeGet(pr, 'commits', 0),
    comments: safeGet(pr, 'comments', 0),
    reviewComments: safeGet(pr, 'review_comments', 0),
    ...normalizePullRefs(pr),
    mergeable: safeGet(pr, 'mergeable'),
    mergeableState: safeGet(pr, 'mergeable_state'),
    merged: Boolean(safeGet(pr, 'merged')),
    mergedBy: safeGet(pr, 'merged_by') ? normalizeGitHubUser(safeGet(pr, 'merged_by')) : null,
    requestedReviewers,
    reviewers,
    labels: Array.isArray(safeGet(pr, 'labels'))
      ? safeGet(pr, 'labels')
          .map((l) => safeGet(l, 'name'))
          .filter(Boolean)
      : [],
    ...provenance,
  };
}

/**
 * Build request parameters for PR listing.
 * @param {object} options - Request options
 * @param {number} options.perPage - Items per page
 * @param {number} options.page - Page number
 * @param {string} options.state - State filter (open, closed, all)
 * @param {string} options.sort - Sort field (created, updated, popularity, long-running)
 * @param {string} options.direction - Sort direction (asc, desc)
 * @param {string} options.base - Filter by base branch
 * @param {string} options.head - Filter by head branch (user:branch)
 * @returns {object} Octokit request parameters
 */
function buildPullParams({
  perPage = DEFAULT_PER_PAGE,
  page = 1,
  state = 'all',
  sort = 'updated',
  direction = 'desc',
  base,
  head,
  etag,
} = {}) {
  if (!VALID_STATES.includes(state)) {
    throw new Error(`Invalid PR state: ${state}. Must be one of: ${VALID_STATES.join(', ')}`);
  }
  const params = {
    per_page: Math.min(perPage, 100),
    page,
    state,
    sort,
    direction,
  };
  if (base) params.base = base;
  if (head) params.head = head;
  if (etag) params.headers = { 'If-None-Match': etag };
  return params;
}

/**
 * Fetch all pull requests for a repository, respecting caps and cursors.
 *
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} repoId - MongoDB repository ID (string)
 * @param {object} options - Fetch options
 * @param {object} options.cursor - Cursor from SyncState (page, etag, since)
 * @param {number} options.maxPrs - Maximum PRs to fetch (overrides env cap)
 * @param {string} options.state - State filter (open, closed, all)
 * @param {object} options.deps - Test dependencies
 * @returns {Promise<{ prs: Array, cursor: object, capReached: boolean, notModified: boolean }>}
 */
async function fetchPullRequests(
  userDoc,
  owner,
  repo,
  repoId,
  { cursor = null, maxPrs = null, state = 'all', deps = {} } = {}
) {
  const caps = getSyncCaps();
  const limit = maxPrs ?? caps.maxPrsPerRepo;
  const client = deps.client ?? createGithubClient(userDoc, deps);

  let page = cursor?.page ?? 1;
  const etag = cursor?.etag ?? null;
  // Incremental boundary (T7.2). The GitHub pulls endpoint has no `since`
  // parameter, so with `since` set we filter client-side and stop paging once
  // a page is entirely at/before the boundary (sort=updated, direction=desc).
  const since = cursor?.since ?? null;
  const prs = [];

  try {
    for (;;) {
      if (prs.length >= limit) {
        return { prs, cursor: createCursor({ page, since }), capReached: true, notModified: false };
      }

      const params = buildPullParams({ perPage: DEFAULT_PER_PAGE, page, state, etag });
      const { data: response, headers } = await client.requestWithHeaders('GET /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        ...params,
      });

      const pagePrs = Array.isArray(response) ? response : [];

      if (pagePrs.length === 0) {
        return {
          prs,
          cursor: createCursor({ page: page + 1, since }),
          capReached: false,
          notModified: false,
        };
      }

      const provenance = createProvenance('rest');
      let reachedBoundary = false;
      const boundaryMs = since ? new Date(since).getTime() : null;
      const truncated = collectPageItems(pagePrs, prs, limit, (pr) => {
        const updatedAt = safeGet(pr, 'updated_at');
        if (boundaryMs !== null && updatedAt) {
          const itemMs = new Date(updatedAt).getTime();
          if (Number.isFinite(itemMs) && itemMs <= boundaryMs) {
            reachedBoundary = true;
            return null; // skip; everything after (updated desc) is at/before since
          }
        }
        return normalizePullRequest(pr, repoId, provenance);
      });
      if (truncated) {
        return { prs, cursor: createCursor({ page, since }), capReached: true, notModified: false };
      }
      if (reachedBoundary) {
        return {
          prs,
          cursor: createCursor({ page: page + 1, since }),
          capReached: false,
          notModified: false,
        };
      }

      // Follow GitHub's Link header when present; otherwise stop on a short
      // page. nextPageFromLink only returns strictly advancing pages.
      const linked = nextPageFromLink(headers, page);
      if (linked !== null) {
        page = linked;
        continue;
      }
      if (pagePrs.length < DEFAULT_PER_PAGE) {
        return {
          prs,
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
      return { prs, cursor, capReached: false, notModified: true };
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
 * Fetch a single pull request by number.
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} number - PR number
 * @param {string} repoId - MongoDB repository ID
 * @param {object} deps - Test dependencies
 * @returns {Promise<object|null>} Normalized PR DTO or null if not found
 */
async function fetchPullRequest(userDoc, owner, repo, number, repoId, deps = {}) {
  const client = deps.client ?? createGithubClient(userDoc, deps);
  try {
    const response = await client.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: number,
    });
    return normalizePullRequest(response, repoId, createProvenance('rest'));
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
 * Fetch PRs for multiple repositories. One repository failing does not
 * abort the others: per-repo failures are collected in `errors` while
 * successful results are kept.
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {Array} repositories - Array of { owner, name, repoId }
 * @param {object} options - Fetch options (passed to each fetchPullRequests call)
 * @param {(info: { key: string, index: number, total: number, cursor: object }) => void} [options.onProgress]
 *   Optional per-repository completion callback (T2.3: progress + checkpoints).
 *   Failures inside the callback propagate (they indicate a broken observer).
 * @returns {Promise<{ prs: Array, cursors: Map, capReached: boolean, errors: Map }>}
 */
async function fetchPullRequestsForRepositories(userDoc, repositories, options = {}) {
  const { onProgress = null, ...singleOptions } = options;
  const allPrs = [];
  const cursors = new Map();
  const errors = new Map();
  let anyCapReached = false;

  let index = 0;
  for (const repo of repositories) {
    const key = `${repo.owner}/${repo.name}`;
    try {
      const { prs, cursor, capReached } = await fetchPullRequests(
        userDoc,
        repo.owner,
        repo.name,
        repo.repoId,
        { ...singleOptions, cursor: options.cursors?.get(key) }
      );
      allPrs.push(...prs);
      cursors.set(key, cursor);
      if (capReached) anyCapReached = true;
      if (onProgress) await onProgress({ key, index, total: repositories.length, cursor });
    } catch (err) {
      errors.set(key, { message: err.message, code: err.code, status: err.status });
    }
    index += 1;
  }

  return { prs: allPrs, cursors, capReached: anyCapReached, errors };
}

module.exports = {
  fetchPullRequests,
  fetchPullRequestsForRepositories,
  fetchPullRequest,
  normalizePullRequest,
  buildPullParams,
  VALID_STATES,
  DEFAULT_PER_PAGE,
};
