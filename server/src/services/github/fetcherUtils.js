/**
 * Shared utilities for GitHub resource fetchers (T2.2).
 *
 * Provides common error types, cursor handling, pagination helpers,
 * and provenance metadata used by all fetchers.
 */

const { getEnv } = require('../../config/env');

/**
 * Typed fetcher errors that map to the documented error envelope codes.
 * These are thrown by fetchers and caught by the orchestrator.
 */

class FetcherError extends Error {
  constructor({ code, message, details, retryable, status }) {
    super(message);
    this.name = 'FetcherError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    this.status = status;
  }
}

function fetcherErrorFor(status, { message, details, retryable } = {}) {
  let code;
  let defaultRetryable;
  switch (status) {
    case 401:
      code = 'UNAUTHENTICATED';
      defaultRetryable = false;
      break;
    case 403:
      // T2.1 contract (githubClient.js): bare 403 (permission/SSO/scope) means
      // the stored grant is insufficient → reconnect required, not retryable.
      code = 'UNAUTHENTICATED';
      defaultRetryable = false;
      break;
    case 404:
      code = 'NOT_FOUND';
      defaultRetryable = false;
      break;
    case 409:
      code = 'SYNC_CONFLICT';
      defaultRetryable = false;
      break;
    case 422:
      code = 'VALIDATION_ERROR';
      defaultRetryable = false;
      break;
    case 429:
      code = 'RATE_LIMITED';
      defaultRetryable = true;
      break;
    default:
      if (status >= 500) {
        code = 'GITHUB_UNREACHABLE';
        defaultRetryable = true;
      } else {
        code = 'GITHUB_UNREACHABLE';
        defaultRetryable = false;
      }
  }
  return new FetcherError({
    code,
    message: message ?? `GitHub API request failed with status ${status}`,
    details,
    retryable: retryable ?? defaultRetryable,
    status,
  });
}

/**
 * Parse GitHub Link header for pagination.
 * Returns { next: url|null, last: url|null, first: url|null, prev: url|null }
 */
function parseLinkHeader(linkHeader) {
  if (!linkHeader) return { next: null, last: null, first: null, prev: null };
  const links = {};
  for (const part of linkHeader.split(',')) {
    const match = part.trim().match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      links[match[2]] = match[1];
    }
  }
  return {
    next: links.next ?? null,
    last: links.last ?? null,
    first: links.first ?? null,
    prev: links.prev ?? null,
  };
}

/**
 * Extract page number from a GitHub pagination URL.
 * Returns null if not found. Uses a regex (not the URL global) to stay
 * within the repo's eslint globals allowlist.
 */
function extractPageFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/[?&]page=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Resolve the next page to fetch from a GitHub `Link` response header.
 * Returns the linked page number only when it strictly advances past
 * `currentPage` — absent, unparseable, or non-advancing `next` links yield
 * null so the caller falls back to page-based termination. The strict
 * advance requirement guarantees Link-driven pagination cannot loop.
 * Header lookup is case-insensitive on the key (`link` / `Link`).
 * @param {object} headers response headers (e.g. Octokit `res.headers`)
 * @param {number} currentPage the page that produced these headers
 * @returns {number|null} the next page number, or null to use the fallback
 */
function nextPageFromLink(headers, currentPage) {
  if (!headers || !Number.isInteger(currentPage)) return null;
  const raw = headers.link ?? headers.Link ?? null;
  if (!raw) return null;
  const next = extractPageFromUrl(parseLinkHeader(raw).next);
  return next !== null && next > currentPage ? next : null;
}

/**
 * Append one page of raw GitHub items to the collected DTO array, stopping
 * at `limit`. Returns true when the cap truncated the page (items were
 * dropped), meaning the result set is incomplete even on a last page.
 * `mapItem` maps a raw item to a DTO, or returns null to skip the item
 * without counting it (the issues fetcher skips PR entries this way).
 * @param {Array} pageItems raw items from one GitHub response page
 * @param {Array} collected DTO accumulator (mutated in place)
 * @param {number} limit maximum DTOs to collect
 * @param {(raw: object) => object|null} mapItem raw item → DTO or null to skip
 * @returns {boolean} true when the cap truncated this page
 */
function collectPageItems(pageItems, collected, limit, mapItem) {
  const before = collected.length;
  for (const raw of pageItems) {
    if (collected.length >= limit) break;
    const dto = mapItem(raw);
    if (dto) collected.push(dto);
  }
  return collected.length >= limit && collected.length - before < pageItems.length;
}

/**
 * Build a cursor object for SyncState persistence.
 * Cursors are per-resource and fetcher-specific.
 */
function createCursor({ page, etag, since, sha }) {
  const cursor = {};
  if (page !== undefined && page !== null) cursor.page = page;
  if (etag !== undefined && etag !== null) cursor.etag = etag;
  if (since !== undefined && since !== null) cursor.since = since;
  if (sha !== undefined && sha !== null) cursor.sha = sha;
  return Object.keys(cursor).length > 0 ? cursor : null;
}

/**
 * Get the configured sync caps from environment.
 * @returns {{ maxRepos: number, maxCommitsPerRepo: number, maxPrsPerRepo: number, maxIssuesPerRepo: number }}
 */
function getSyncCaps() {
  const env = getEnv();
  return {
    maxRepos: env.SYNC_MAX_REPOS,
    maxCommitsPerRepo: env.SYNC_MAX_COMMITS_PER_REPO,
    maxPrsPerRepo: env.SYNC_MAX_PRS_PER_REPO,
    maxIssuesPerRepo: env.SYNC_MAX_ISSUES_PER_REPO,
  };
}

/**
 * Standard provenance metadata attached to all fetched resources.
 * @param {string} source - 'rest' or 'webhook'
 * @returns {{ fetchedAt: Date, source: string }}
 */
function createProvenance(source = 'rest') {
  return {
    fetchedAt: new Date(),
    source,
  };
}

/**
 * Check if a response is 304 Not Modified.
 */
function isNotModified(status) {
  return status === 304;
}

/**
 * Safely get a nested property from an object, returning default if missing.
 */
function safeGet(obj, path, defaultValue = null) {
  if (!obj) return defaultValue;
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return defaultValue;
    current = current[key];
  }
  return current !== undefined ? current : defaultValue;
}

/**
 * Truncate a string to a maximum length.
 */
function truncate(str, maxLength) {
  if (!str || typeof str !== 'string') return str;
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

/**
 * Normalize a GitHub user object to a minimal safe shape.
 */
function normalizeGitHubUser(user) {
  if (!user) return null;
  return {
    login: safeGet(user, 'login'),
    id: safeGet(user, 'id'),
    avatarUrl: safeGet(user, 'avatar_url'),
    url: safeGet(user, 'url'),
    type: safeGet(user, 'type'),
  };
}

module.exports = {
  FetcherError,
  fetcherErrorFor,
  parseLinkHeader,
  extractPageFromUrl,
  nextPageFromLink,
  collectPageItems,
  createCursor,
  getSyncCaps,
  createProvenance,
  isNotModified,
  safeGet,
  truncate,
  normalizeGitHubUser,
};
