/**
 * P2.2 — RepoDetail mini-timeline: range/granularity contract.
 *
 * No-MongoDB unit tests (node:test mock.method, Node 24):
 *  - getMiniTimeline derives the canonical granularity per range (prd.md §18.1)
 *    and queries ONLY (userId, repoId, range, granularity) so incompatible
 *    buckets are never reused.
 *  - repoDetailHandler forwards the validated ?range into getMiniTimeline.
 *
 * DB-gated owned/cross-user route coverage lives in repos.routes.test.js.
 */
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { getMiniTimeline } = require('../src/services/repos/repos.service');

const USER_ID = '64b64b64b64b64b64b64b64b';
const REPO_ID = '64b64b64b64b64b64b64b64c';

// Same model instance the service imports, so mock.method is observed by it.
const ActivityBucketStub = require('../src/models/ActivityBucket');

function fakeQuery(rows) {
  return {
    sort: () => ({ lean: async () => rows }),
  };
}

describe('getMiniTimeline range/granularity (P2.2)', () => {
  let lastFilter;

  beforeEach(() => {
    lastFilter = null;
    mock.method(ActivityBucketStub, 'find', (filter) => {
      lastFilter = filter;
      return fakeQuery([]);
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('30d queries day buckets for range 30d only', async () => {
    await getMiniTimeline(USER_ID, REPO_ID, '30d');
    assert.equal(lastFilter.range, '30d');
    assert.equal(lastFilter.granularity, 'day');
  });

  it('90d queries week buckets for range 90d only (never reuses 30d/day)', async () => {
    await getMiniTimeline(USER_ID, REPO_ID, '90d');
    assert.equal(lastFilter.range, '90d');
    assert.equal(lastFilter.granularity, 'week');
  });

  it('12m queries week buckets for range 12m only', async () => {
    await getMiniTimeline(USER_ID, REPO_ID, '12m');
    assert.equal(lastFilter.range, '12m');
    assert.equal(lastFilter.granularity, 'week');
  });

  it('always scopes to the requested user and repo', async () => {
    await getMiniTimeline(USER_ID, REPO_ID, '90d');
    assert.ok(lastFilter.userId, 'userId must be set');
    assert.equal(lastFilter.userId.toString(), USER_ID);
    assert.equal(lastFilter.repoId, REPO_ID);
  });

  it('binds bucketStart to the range window', async () => {
    await getMiniTimeline(USER_ID, REPO_ID, '30d');
    assert.ok(lastFilter.bucketStart && lastFilter.bucketStart.$gte && lastFilter.bucketStart.$lte);
  });

  it('maps persisted buckets to the 5-field contract (prd §18.1)', async () => {
    mock.restoreAll();
    mock.method(ActivityBucketStub, 'find', () =>
      fakeQuery([
        {
          bucketStart: new Date('2026-10-05T00:00:00Z'),
          commits: 3,
          prsOpened: 1,
          prsMerged: 0,
          issuesTouched: 2,
        },
      ])
    );
    const out = await getMiniTimeline(USER_ID, REPO_ID, '90d');
    assert.equal(out.length, 1);
    assert.deepEqual(
      Object.keys(out[0]).sort(),
      ['bucketStart', 'commits', 'prsOpened', 'prsMerged', 'issuesTouched'].sort()
    );
    assert.equal(out[0].commits, 3);
  });

  it('empty / not-yet-computed data resolves to [] without throwing', async () => {
    mock.restoreAll();
    mock.method(ActivityBucketStub, 'find', () => fakeQuery([]));
    const out = await getMiniTimeline(USER_ID, REPO_ID, '12m');
    assert.deepEqual(out, []);
  });
});

// Controller forwarding: mock the service module's exports BEFORE the
// controller module is first required, so the destructured bindings pick up
// the mocked getMiniTimeline (and the repo lookup is stubbed, no DB).
describe('repoDetailHandler forwards ?range to getMiniTimeline (P2.2)', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('calls getMiniTimeline with the requested range and returns miniTimeline', async () => {
    const reposService = require('../src/services/repos/repos.service');
    const calls = [];
    mock.method(reposService, 'getRecentActivity', async () => ({
      commits: [],
      pullRequests: [],
      issues: [],
    }));
    mock.method(reposService, 'getRepoHealthForIds', async () => new Map());
    mock.method(reposService, 'getMiniTimeline', async (userId, repoId, range) => {
      calls.push({ userId: userId.toString(), repoId, range });
      return [{ bucketStart: new Date(), commits: 1, prsOpened: 0, prsMerged: 0, issuesTouched: 0 }];
    });

    const Repository = require('../src/models/Repository');
    mock.method(Repository, 'findOne', () => ({
      lean: async () => ({ _id: REPO_ID, fullName: 'tester/app', htmlUrl: 'https://github.com/tester/app' }),
    }));

    const { repoDetailHandler } = require('../src/services/repos/repos.controller');
    const req = { user: { id: USER_ID }, params: { id: REPO_ID }, query: { range: '12m' } };
    let statusCode = null;
    let body = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (payload) => {
        body = payload;
      },
    };

    await repoDetailHandler(req, res);

    assert.equal(statusCode, null); // success path calls res.json directly
    assert.equal(calls.length, 1);
    assert.equal(calls[0].range, '12m');
    assert.equal(calls[0].userId, USER_ID);
    assert.ok(Array.isArray(body.miniTimeline));
    assert.equal(body.miniTimeline[0].commits, 1);
  });
});
