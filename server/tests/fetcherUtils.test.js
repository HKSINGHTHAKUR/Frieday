/**
 * Fetcher utilities tests (T2.2).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  fetcherErrorFor,
  parseLinkHeader,
  extractPageFromUrl,
  nextPageFromLink,
  collectPageItems,
  createCursor,
  createProvenance,
  isNotModified,
  safeGet,
  truncate,
  normalizeGitHubUser,
} = require('../src/services/github/fetcherUtils');

describe('fetcherUtils', () => {
  describe('fetcherErrorFor', () => {
    it('maps 401 to UNAUTHENTICATED non-retryable', () => {
      const err = fetcherErrorFor(401);
      assert.equal(err.code, 'UNAUTHENTICATED');
      assert.equal(err.retryable, false);
      assert.equal(err.status, 401);
    });

    it('maps 403 to UNAUTHENTICATED non-retryable (T2.1 contract)', () => {
      const err = fetcherErrorFor(403);
      assert.equal(err.code, 'UNAUTHENTICATED');
      assert.equal(err.retryable, false);
      assert.equal(err.status, 403);
    });

    it('maps 404 to NOT_FOUND non-retryable', () => {
      const err = fetcherErrorFor(404);
      assert.equal(err.code, 'NOT_FOUND');
      assert.equal(err.retryable, false);
      assert.equal(err.status, 404);
    });

    it('maps 409 to SYNC_CONFLICT non-retryable', () => {
      const err = fetcherErrorFor(409);
      assert.equal(err.code, 'SYNC_CONFLICT');
      assert.equal(err.retryable, false);
      assert.equal(err.status, 409);
    });

    it('maps 422 to VALIDATION_ERROR non-retryable', () => {
      const err = fetcherErrorFor(422);
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.retryable, false);
      assert.equal(err.status, 422);
    });

    it('maps 429 to RATE_LIMITED retryable', () => {
      const err = fetcherErrorFor(429);
      assert.equal(err.code, 'RATE_LIMITED');
      assert.equal(err.retryable, true);
      assert.equal(err.status, 429);
    });

    it('maps 500 to GITHUB_UNREACHABLE retryable', () => {
      const err = fetcherErrorFor(500);
      assert.equal(err.code, 'GITHUB_UNREACHABLE');
      assert.equal(err.retryable, true);
      assert.equal(err.status, 500);
    });

    it('maps 503 to GITHUB_UNREACHABLE retryable', () => {
      const err = fetcherErrorFor(503);
      assert.equal(err.code, 'GITHUB_UNREACHABLE');
      assert.equal(err.retryable, true);
      assert.equal(err.status, 503);
    });

    it('allows custom message and details', () => {
      const err = fetcherErrorFor(403, {
        message: 'Custom message',
        details: { foo: 'bar' },
        retryable: true,
      });
      assert.equal(err.message, 'Custom message');
      assert.deepEqual(err.details, { foo: 'bar' });
      assert.equal(err.retryable, true);
    });
  });

  describe('parseLinkHeader', () => {
    it('parses a full Link header', () => {
      const link =
        '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"';
      const parsed = parseLinkHeader(link);
      assert.equal(parsed.next, 'https://api.github.com/user/repos?page=2');
      assert.equal(parsed.last, 'https://api.github.com/user/repos?page=5');
      assert.equal(parsed.first, null);
      assert.equal(parsed.prev, null);
    });

    it('returns null for missing relations', () => {
      const parsed = parseLinkHeader('<https://api.github.com/user/repos?page=1>; rel="first"');
      assert.equal(parsed.next, null);
      assert.equal(parsed.last, null);
      assert.equal(parsed.first, 'https://api.github.com/user/repos?page=1');
      assert.equal(parsed.prev, null);
    });

    it('returns all null for empty/undefined header', () => {
      assert.deepEqual(parseLinkHeader(''), { next: null, last: null, first: null, prev: null });
      assert.deepEqual(parseLinkHeader(null), { next: null, last: null, first: null, prev: null });
      assert.deepEqual(parseLinkHeader(undefined), { next: null, last: null, first: null, prev: null });
    });
  });

  describe('extractPageFromUrl', () => {
    it('extracts page number from URL', () => {
      assert.equal(extractPageFromUrl('https://api.github.com/user/repos?page=5'), 5);
      assert.equal(extractPageFromUrl('https://api.github.com/user/repos?page=1&per_page=100'), 1);
    });

    it('returns null for URL without page', () => {
      assert.equal(extractPageFromUrl('https://api.github.com/user/repos'), null);
    });

    it('returns null for invalid URL', () => {
      assert.equal(extractPageFromUrl('not-a-url'), null);
    });
  });

  describe('nextPageFromLink', () => {
    const linkTo = (page) => `<https://api.github.com/user/repos?per_page=100&page=${page}>; rel="next"`;

    it('returns the linked next page when it advances', () => {
      assert.equal(nextPageFromLink({ link: linkTo(2) }, 1), 2);
      assert.equal(nextPageFromLink({ link: linkTo(5) }, 3), 5);
    });

    it('accepts a capitalized Link key', () => {
      assert.equal(nextPageFromLink({ Link: linkTo(2) }, 1), 2);
    });

    it('returns null when no Link header is present', () => {
      assert.equal(nextPageFromLink({}, 1), null);
      assert.equal(nextPageFromLink(null, 1), null);
      assert.equal(nextPageFromLink(undefined, 1), null);
    });

    it('returns null when the Link header has no next relation', () => {
      assert.equal(nextPageFromLink({ link: '<https://api.github.com/x?page=1>; rel="first"' }, 1), null);
    });

    it('returns null for a non-advancing next page (loop guard)', () => {
      assert.equal(nextPageFromLink({ link: linkTo(1) }, 1), null);
      assert.equal(nextPageFromLink({ link: linkTo(1) }, 2), null);
    });

    it('returns null for an unparseable next URL', () => {
      assert.equal(nextPageFromLink({ link: '<not-a-url>; rel="next"' }, 1), null);
    });

    it('returns null for a non-integer current page', () => {
      assert.equal(nextPageFromLink({ link: linkTo(2) }, null), null);
      assert.equal(nextPageFromLink({ link: linkTo(2) }, '1'), null);
    });
  });

  describe('collectPageItems', () => {
    const identity = (x) => x;

    it('collects all items under the limit without truncation', () => {
      const collected = [];
      assert.equal(collectPageItems([1, 2, 3], collected, 10, identity), false);
      assert.deepEqual(collected, [1, 2, 3]);
    });

    it('reports truncation when the cap drops items', () => {
      const collected = [];
      assert.equal(collectPageItems([1, 2, 3, 4, 5], collected, 3, identity), true);
      assert.deepEqual(collected, [1, 2, 3]);
    });

    it('does not report truncation at an exact boundary with nothing dropped', () => {
      const collected = [];
      assert.equal(collectPageItems([1, 2, 3], collected, 3, identity), false);
      assert.deepEqual(collected, [1, 2, 3]);
    });

    it('skips null-mapped items without counting them as truncation', () => {
      const collected = [];
      const skipEvens = (x) => (x % 2 === 0 ? null : x);
      assert.equal(collectPageItems([1, 2, 3], collected, 10, skipEvens), false);
      assert.deepEqual(collected, [1, 3]);
    });

    it('handles an empty page', () => {
      const collected = [];
      assert.equal(collectPageItems([], collected, 10, identity), false);
      assert.deepEqual(collected, []);
    });
  });

  describe('createCursor', () => {
    it('creates cursor with provided values', () => {
      const cursor = createCursor({ page: 3, etag: 'abc123', since: '2024-01-01T00:00:00Z', sha: 'def456' });
      assert.deepEqual(cursor, { page: 3, etag: 'abc123', since: '2024-01-01T00:00:00Z', sha: 'def456' });
    });

    it('omits undefined/null values', () => {
      const cursor = createCursor({ page: 2, etag: null, since: undefined, sha: 'abc' });
      assert.deepEqual(cursor, { page: 2, sha: 'abc' });
    });

    it('returns null for empty object', () => {
      assert.equal(createCursor({}), null);
      assert.equal(createCursor({ page: null }), null);
    });
  });

  describe('createProvenance', () => {
    it('returns provenance with fetchedAt and source', () => {
      const prov = createProvenance('rest');
      assert.ok(prov.fetchedAt instanceof Date);
      assert.equal(prov.source, 'rest');
    });

    it('defaults source to rest', () => {
      const prov = createProvenance();
      assert.equal(prov.source, 'rest');
    });
  });

  describe('isNotModified', () => {
    it('returns true for 304', () => {
      assert.equal(isNotModified(304), true);
    });

    it('returns false for other statuses', () => {
      assert.equal(isNotModified(200), false);
      assert.equal(isNotModified(404), false);
    });
  });

  describe('safeGet', () => {
    it('returns nested value', () => {
      const obj = { a: { b: { c: 'value' } } };
      assert.equal(safeGet(obj, 'a.b.c'), 'value');
    });

    it('returns default for missing path', () => {
      assert.equal(safeGet({}, 'a.b.c', 'default'), 'default');
      assert.equal(safeGet({ a: {} }, 'a.b.c', 'default'), 'default');
      assert.equal(safeGet(null, 'a.b.c', 'default'), 'default');
    });
  });

  describe('truncate', () => {
    it('truncates long strings', () => {
      assert.equal(truncate('a'.repeat(100), 50), 'a'.repeat(50));
    });

    it('returns original for short strings', () => {
      assert.equal(truncate('hello', 10), 'hello');
    });

    it('handles null/undefined', () => {
      assert.equal(truncate(null, 10), null);
      assert.equal(truncate(undefined, 10), undefined);
    });

    it('handles non-strings', () => {
      assert.equal(truncate(123, 10), 123);
    });
  });

  describe('normalizeGitHubUser', () => {
    it('normalizes user object', () => {
      const user = {
        login: 'octocat',
        id: 1,
        avatar_url: 'https://example.com/avatar.png',
        url: 'https://api.github.com/users/octocat',
        type: 'User',
      };
      const normalized = normalizeGitHubUser(user);
      assert.equal(normalized.login, 'octocat');
      assert.equal(normalized.id, 1);
      assert.equal(normalized.avatarUrl, 'https://example.com/avatar.png');
      assert.equal(normalized.url, 'https://api.github.com/users/octocat');
      assert.equal(normalized.type, 'User');
    });

    it('returns null for null input', () => {
      assert.equal(normalizeGitHubUser(null), null);
    });

    it('handles missing fields', () => {
      const user = { login: 'octocat' };
      const normalized = normalizeGitHubUser(user);
      assert.equal(normalized.login, 'octocat');
      assert.equal(normalized.id, null);
    });
  });
});
