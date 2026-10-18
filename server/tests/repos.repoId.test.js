/**
 * P3.1 — GET /api/repos/:id malformed repoId error handling.
 *
 * No-MongoDB unit tests (node:test mock.method): pin the contract that a
 * malformed/garbage repoId yields a clean 404 NOT_FOUND (never a Mongo
 * CastError / HTTP 500), that a genuinely valid-but-nonexistent ObjectId is
 * also 404, and that only a valid owned repo returns 200. The controller's
 * findAndValidateRepo guards ObjectId.isValid before converting, so no
 * ObjectId conversion ever runs on garbage.
 */
const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const USER_ID = '64b64b64b64b64b64b64b64b';
const OWNED_REPO_ID = '64b64b64b64b64b64b64b64c';
const VALID_NONEXISTENT_ID = '6ac5140b46441902c2424cc8'; // 24-hex, valid format, no such repo

function setupController({ findOneResult = null } = {}) {
  // Mock the service module exports BEFORE requiring the controller so its
  // destructured bindings pick up the mocks (same pattern as P2.2).
  const reposService = require('../src/services/repos/repos.service');
  mock.method(reposService, 'getRecentActivity', async () => ({ commits: [], pullRequests: [], issues: [] }));
  mock.method(reposService, 'getRepoHealthForIds', async () => new Map());
  mock.method(reposService, 'getMiniTimeline', async () => []);

  const Repository = require('../src/models/Repository');
  const findOneMock = mock.method(Repository, 'findOne', () => ({
    lean: async () => findOneResult,
  }));

  const { repoDetailHandler } = require('../src/services/repos/repos.controller');
  return { repoDetailHandler, findOneMock };
}

function makeRes() {
  const calls = { status: null, json: null };
  const res = {
    status: (code) => {
      calls.status = code;
      return res;
    },
    json: (payload) => {
      calls.json = payload;
    },
  };
  return { res, calls };
}

async function callDetail(repoDetailHandler, id) {
  const req = { user: { id: USER_ID }, params: { id }, query: { range: '90d' } };
  const { res, calls } = makeRes();
  await repoDetailHandler(req, res);
  return calls;
}

describe('GET /api/repos/:id malformed repoId contract (P3.1)', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const ownedRepo = {
    _id: OWNED_REPO_ID,
    fullName: 'tester/app',
    githubId: 123,
    owner: 'tester',
    name: 'app',
    visibility: 'public',
    primaryLanguage: 'js',
    stars: 0,
    fork: false,
    pushedAt: new Date(),
    githubUpdatedAt: new Date(),
    description: null,
    htmlUrl: 'https://github.com/tester/app',
  };

  it('A: owned valid repoId returns 200', async () => {
    const { repoDetailHandler, findOneMock } = setupController({ findOneResult: ownedRepo });
    const calls = await callDetail(repoDetailHandler, OWNED_REPO_ID);
    assert.equal(calls.status, null); // success path calls res.json directly
    assert.ok(calls.json && calls.json.fullName === 'tester/app');
    assert.equal(findOneMock.mock.calls.length, 1);
  });

  it('B: genuinely valid but nonexistent ObjectId returns 404 NOT_FOUND', async () => {
    const { repoDetailHandler } = setupController({ findOneResult: null });
    const calls = await callDetail(repoDetailHandler, VALID_NONEXISTENT_ID);
    assert.equal(calls.status, 404);
    assert.equal(calls.json.error.code, 'NOT_FOUND');
  });

  it('C: a repo owned by another user is not reachable (404)', async () => {
    // findAndValidateRepo queries with userId; a mismatched user yields no row.
    const { repoDetailHandler } = setupController({ findOneResult: null });
    const calls = await callDetail(repoDetailHandler, OWNED_REPO_ID);
    assert.equal(calls.status, 404);
    assert.equal(calls.json.error.code, 'NOT_FOUND');
  });

  it('D: malformed repoId returns clean 404, never 500, and never converts garbage', async () => {
    const { repoDetailHandler, findOneMock } = setupController({ findOneResult: null });
    const calls = await callDetail(repoDetailHandler, 'not-an-object-id');
    assert.equal(calls.status, 404);
    assert.equal(calls.json.error.code, 'NOT_FOUND');
    // The isValid guard returns before any ObjectId conversion / DB query.
    assert.equal(findOneMock.mock.calls.length, 0);
  });

  it('E: malformed variants (abc, long garbage, 24-hex garbage) all return clean 404', async () => {
    const malformedIds = ['abc', 'x'.repeat(50), 'zzzzzzzzzzzzzzzzzzzzzzzz'];
    for (const id of malformedIds) {
      const { repoDetailHandler } = setupController({ findOneResult: null });
      const calls = await callDetail(repoDetailHandler, id);
      assert.equal(calls.status, 404, `id=${id} must be 404`);
      assert.equal(calls.json.error.code, 'NOT_FOUND');
    }
  });
});
