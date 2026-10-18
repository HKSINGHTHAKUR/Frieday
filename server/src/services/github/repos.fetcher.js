/**
 * Repository fetcher (T2.2).
 *
 * Fetches repositories for the authenticated user with pagination,
 * ETag/since cursor support, and sync caps.
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

/**
 * Normalize a raw GitHub repository object to a DTO.
 * Handles missing/optional fields defensively.
 * @param {object} repo - Raw repository from GitHub API
 * @param {object} provenance - Provenance metadata
 * @returns {object} Normalized repository DTO
 */
function normalizeRepo(repo, provenance) {
  const owner = normalizeGitHubUser(safeGet(repo, 'owner'));
  return {
    githubId: safeGet(repo, 'id'),
    owner: owner?.login ?? null,
    name: safeGet(repo, 'name'),
    fullName: safeGet(repo, 'full_name'),
    visibility: safeGet(repo, 'visibility') ?? (safeGet(repo, 'private') ? 'private' : 'public'),
    primaryLanguage: safeGet(repo, 'language'),
    stars: safeGet(repo, 'stargazers_count', 0),
    fork: Boolean(safeGet(repo, 'fork')),
    defaultBranch: safeGet(repo, 'default_branch'),
    githubUpdatedAt: safeGet(repo, 'updated_at') ? new Date(safeGet(repo, 'updated_at')) : null,
    pushedAt: safeGet(repo, 'pushed_at') ? new Date(safeGet(repo, 'pushed_at')) : null,
    archived: Boolean(safeGet(repo, 'archived')),
    disabled: Boolean(safeGet(repo, 'disabled')),
    description: truncate(safeGet(repo, 'description'), 500),
    htmlUrl: safeGet(repo, 'html_url'),
    cloneUrl: safeGet(repo, 'clone_url'),
    sshUrl: safeGet(repo, 'ssh_url'),
    homepage: safeGet(repo, 'homepage'),
    topics: Array.isArray(safeGet(repo, 'topics')) ? safeGet(repo, 'topics') : [],
    license: safeGet(repo, 'license')
      ? {
          key: safeGet(repo, 'license.key'),
          name: safeGet(repo, 'license.name'),
          spdxId: safeGet(repo, 'license.spdx_id'),
        }
      : null,
    ...provenance,
  };
}

/**
 * Build request parameters for repository listing.
 * @param {object} options - Request options
 * @param {number} options.perPage - Items per page
 * @param {number} options.page - Page number
 * @param {string} options.since - ISO timestamp for incremental sync
 * @param {string} options.etag - ETag for conditional request
 * @param {string} options.sort - Sort order (created, updated, pushed, full_name)
 * @param {string} options.direction - Sort direction (asc, desc)
 * @param {string} options.affiliation - Comma-separated affiliation filter
 * @returns {object} Octokit request parameters
 */
function buildRepoParams({
  perPage = DEFAULT_PER_PAGE,
  page = 1,
  since,
  etag,
  sort = 'pushed',
  direction = 'desc',
  affiliation = 'owner,collaborator,organization_member',
} = {}) {
  const params = {
    per_page: Math.min(perPage, 100),
    page,
    sort,
    direction,
    affiliation,
  };
  if (since) params.since = since;
  if (etag) params.headers = { 'If-None-Match': etag };
  return params;
}

/**
 * Fetch all repositories for the user, respecting caps and cursors.
 *
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {object} options - Fetch options
 * @param {object} options.cursor - Cursor from SyncState (page, etag, since)
 * @param {number} options.maxRepos - Maximum repositories to fetch (overrides env cap)
 * @param {object} options.deps - Test dependencies (client, OctokitImpl, githubConfig)
 * @returns {Promise<{ repos: Array, cursor: object, capReached: boolean, notModified: boolean }>}
 */
async function fetchRepositories(userDoc, { cursor = null, maxRepos = null, deps = {} } = {}) {
  const caps = getSyncCaps();
  const limit = maxRepos ?? caps.maxRepos;
  const client = deps.client ?? createGithubClient(userDoc, deps);

  let page = cursor?.page ?? 1;
  const etag = cursor?.etag ?? null;
  const since = cursor?.since ?? null;
  const repos = [];
  let finalCursor = { page: 1 };

  try {
    for (;;) {
      if (repos.length >= limit) {
        finalCursor = createCursor({ page, etag: null, since });
        return { repos, cursor: finalCursor, capReached: true, notModified: false };
      }

      const params = buildRepoParams({ perPage: DEFAULT_PER_PAGE, page, since, etag });
      const { data: response, headers } = await client.requestWithHeaders('GET /user/repos', params);

      // Handle 304 Not Modified (would be thrown as error by githubClient, so we check response)
      // Note: githubClient throws on non-2xx, so 304 would be an error. We need to handle it.
      // Actually, githubClient.request throws on >=400, so 304 is not handled here.
      // We'll need to handle 304 at a lower level or accept it as a non-error.

      const pageRepos = Array.isArray(response) ? response : [];

      if (pageRepos.length === 0) {
        finalCursor = createCursor({ page: page + 1, etag: null, since });
        return { repos, cursor: finalCursor, capReached: false, notModified: false };
      }

      const provenance = createProvenance('rest');
      const truncated = collectPageItems(pageRepos, repos, limit, (repo) => normalizeRepo(repo, provenance));
      if (truncated) {
        finalCursor = createCursor({ page, etag: null, since });
        return { repos, cursor: finalCursor, capReached: true, notModified: false };
      }

      // Follow GitHub's Link header when present (server-authoritative next
      // page); otherwise fall back to page-based termination on a short page.
      // nextPageFromLink only returns strictly advancing pages, so Link-driven
      // pagination cannot loop.
      const linked = nextPageFromLink(headers, page);
      if (linked !== null) {
        page = linked;
        continue;
      }
      if (pageRepos.length < DEFAULT_PER_PAGE) {
        finalCursor = createCursor({ page: page + 1, etag: null, since });
        return { repos, cursor: finalCursor, capReached: false, notModified: false };
      }

      page += 1;
    }
  } catch (err) {
    // 304 Not Modified (Octokit throws; githubClient passes it through raw
    // because it is not an error status): nothing changed, keep cached data.
    if (isNotModified(err?.status)) {
      return { repos, cursor, capReached: false, notModified: true };
    }
    // Re-throw fetcher errors with proper codes
    if (err instanceof Error && err.code) {
      throw err;
    }
    // Network or unknown error
    throw fetcherErrorFor(500, {
      message: err.message,
      details: { originalError: err.name },
      retryable: true,
    });
  }
}

/**
 * Fetch a single repository by owner and name.
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {object} deps - Test dependencies
 * @returns {Promise<object|null>} Normalized repository DTO or null if not found
 */
async function fetchRepository(userDoc, owner, repo, deps = {}) {
  const client = deps.client ?? createGithubClient(userDoc, deps);
  try {
    const response = await client.request('GET /repos/{owner}/{repo}', { owner, repo });
    return normalizeRepo(response, createProvenance('rest'));
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

module.exports = {
  fetchRepositories,
  fetchRepository,
  normalizeRepo,
  buildRepoParams,
  DEFAULT_PER_PAGE,
};
