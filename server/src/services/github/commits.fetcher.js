/**
 * Commits fetcher (T2.2).
 *
 * Fetches commits for a repository with pagination, since/ETag cursors,
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
} = require('./fetcherUtils');

const DEFAULT_PER_PAGE = 100;

/**
 * Normalize a raw GitHub commit object to a DTO.
 * Handles missing/optional fields defensively.
 * @param {object} commit - Raw commit from GitHub API
 * @param {string} repoId - Repository ID (MongoDB ObjectId as string)
 * @param {object} provenance - Provenance metadata
 * @returns {object} Normalized commit DTO
 */
function normalizeCommit(commit, repoId, provenance) {
  const author = safeGet(commit, 'author');
  const committer = safeGet(commit, 'committer');
  const gitCommit = safeGet(commit, 'commit');
  const authorInfo = author
    ? {
        login: safeGet(author, 'login'),
        id: safeGet(author, 'id'),
        avatarUrl: safeGet(author, 'avatar_url'),
      }
    : null;
  const committerInfo = committer
    ? {
        login: safeGet(committer, 'login'),
        id: safeGet(committer, 'id'),
        avatarUrl: safeGet(committer, 'avatar_url'),
      }
    : null;

  const message = safeGet(gitCommit, 'message') ?? '';
  const messageLines = message.split('\n');
  const headline = truncate(messageLines[0], 120);
  const full = truncate(message, 500);

  const files = Array.isArray(safeGet(commit, 'files'))
    ? safeGet(commit, 'files')
        .map((f) => safeGet(f, 'filename'))
        .filter(Boolean)
        .slice(0, 50)
    : [];

  return {
    sha: safeGet(commit, 'sha'),
    repoId,
    messageHeadline: headline,
    messageFull: full,
    authoredAt: safeGet(gitCommit, 'author.date') ? new Date(safeGet(gitCommit, 'author.date')) : null,
    committedAt: safeGet(gitCommit, 'committer.date') ? new Date(safeGet(gitCommit, 'committer.date')) : null,
    author: authorInfo,
    committer: committerInfo,
    additions: safeGet(commit, 'stats.additions', 0),
    deletions: safeGet(commit, 'stats.deletions', 0),
    total: safeGet(commit, 'stats.total', 0),
    files,
    parents: Array.isArray(safeGet(commit, 'parents'))
      ? safeGet(commit, 'parents')
          .map((p) => safeGet(p, 'sha'))
          .filter(Boolean)
      : [],
    ...provenance,
  };
}

/**
 * Build request parameters for commit listing.
 * @param {object} options - Request options
 * @param {number} options.perPage - Items per page
 * @param {number} options.page - Page number
 * @param {string} options.since - ISO timestamp for incremental sync
 * @param {string} options.until - ISO timestamp for upper bound
 * @param {string} options.sha - Branch/commit SHA to start from
 * @param {string} options.path - Filter by file path
 * @param {string} options.author - Filter by author login
 * @returns {object} Octokit request parameters
 */
function buildCommitParams({
  perPage = DEFAULT_PER_PAGE,
  page = 1,
  since,
  until,
  sha,
  path,
  author,
  etag,
} = {}) {
  const params = {
    per_page: Math.min(perPage, 100),
    page,
  };
  if (since) params.since = since;
  if (until) params.until = until;
  if (sha) params.sha = sha;
  if (path) params.path = path;
  if (author) params.author = author;
  if (etag) params.headers = { 'If-None-Match': etag };
  return params;
}

/**
 * Fetch all commits for a repository, respecting caps and cursors.
 *
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} repoId - MongoDB repository ID (string)
 * @param {object} options - Fetch options
 * @param {object} options.cursor - Cursor from SyncState (page, etag, since, sha)
 * @param {number} options.maxCommits - Maximum commits to fetch (overrides env cap)
 * @param {object} options.deps - Test dependencies
 * @returns {Promise<{ commits: Array, cursor: object, capReached: boolean, notModified: boolean }>}
 */
async function fetchCommits(
  userDoc,
  owner,
  repo,
  repoId,
  { cursor = null, maxCommits = null, deps = {} } = {}
) {
  const caps = getSyncCaps();
  const limit = maxCommits ?? caps.maxCommitsPerRepo;
  const client = deps.client ?? createGithubClient(userDoc, deps);

  let page = cursor?.page ?? 1;
  const etag = cursor?.etag ?? null;
  const since = cursor?.since ?? null;
  const sha = cursor?.sha ?? null;
  const commits = [];

  try {
    for (;;) {
      if (commits.length >= limit) {
        return { commits, cursor: createCursor({ page, since, sha }), capReached: true, notModified: false };
      }

      const params = buildCommitParams({ perPage: DEFAULT_PER_PAGE, page, since, sha, etag });
      const { data: response, headers } = await client.requestWithHeaders(
        'GET /repos/{owner}/{repo}/commits',
        { owner, repo, ...params }
      );

      const pageCommits = Array.isArray(response) ? response : [];

      if (pageCommits.length === 0) {
        return {
          commits,
          cursor: createCursor({ page: page + 1, since, sha }),
          capReached: false,
          notModified: false,
        };
      }

      const provenance = createProvenance('rest');
      const truncated = collectPageItems(pageCommits, commits, limit, (commit) =>
        normalizeCommit(commit, repoId, provenance)
      );
      if (truncated) {
        return { commits, cursor: createCursor({ page, since, sha }), capReached: true, notModified: false };
      }

      // Follow GitHub's Link header when present; otherwise stop on a short
      // page. nextPageFromLink only returns strictly advancing pages.
      const linked = nextPageFromLink(headers, page);
      if (linked !== null) {
        page = linked;
        continue;
      }
      if (pageCommits.length < DEFAULT_PER_PAGE) {
        return {
          commits,
          cursor: createCursor({ page: page + 1, since, sha }),
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
      return { commits, cursor, capReached: false, notModified: true };
    }
    // 409 on the commits endpoint means the repository has no git history
    // (empty repo): an empty result, not a failure.
    if (err?.status === 409) {
      return { commits, cursor: createCursor({ page, since, sha }), capReached: false, notModified: false };
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
 * Fetch commits for multiple repositories. One repository failing does not
 * abort the others: per-repo failures are collected in `errors` while
 * successful results are kept.
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {Array} repositories - Array of { owner, name, repoId }
 * @param {object} options - Fetch options (passed to each fetchCommits call)
 * @param {(info: { key: string, index: number, total: number, cursor: object }) => void} [options.onProgress]
 *   Optional per-repository completion callback (T2.3: progress + checkpoints).
 *   Failures inside the callback propagate (they indicate a broken observer).
 * @returns {Promise<{ commits: Array, cursors: Map, capReached: boolean, errors: Map }>}
 */
async function fetchCommitsForRepositories(userDoc, repositories, options = {}) {
  const { onProgress = null, ...singleOptions } = options;
  const allCommits = [];
  const cursors = new Map();
  const errors = new Map();
  let anyCapReached = false;

  let index = 0;
  for (const repo of repositories) {
    const key = `${repo.owner}/${repo.name}`;
    try {
      const { commits, cursor, capReached } = await fetchCommits(
        userDoc,
        repo.owner,
        repo.name,
        repo.repoId,
        { ...singleOptions, cursor: options.cursors?.get(key) }
      );
      allCommits.push(...commits);
      cursors.set(key, cursor);
      if (capReached) anyCapReached = true;
      if (onProgress) await onProgress({ key, index, total: repositories.length, cursor });
    } catch (err) {
      errors.set(key, { message: err.message, code: err.code, status: err.status });
    }
    index += 1;
  }

  return { commits: allCommits, cursors, capReached: anyCapReached, errors };
}

module.exports = {
  fetchCommits,
  fetchCommitsForRepositories,
  normalizeCommit,
  buildCommitParams,
  DEFAULT_PER_PAGE,
};
