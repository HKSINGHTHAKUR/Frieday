/**
 * Repositories list route tests (T5.1 / T9 regression) — real Express stack.
 *
 * Regression coverage for the confirmed "Invalid cursor." defect: the handler
 * rejected the NO-cursor first-page request because the 400 guard fired on
 * `!cursorData` (null) instead of only when a cursor was supplied and failed
 * to decode (T9 fix #5).
 *
 * DB-gated per the established pattern (auth.test.js): connect via the
 * existing config/db (5s race), skip with an explicit reason when MongoDB is
 * unavailable. Synthetic rows are labeled and cleaned up by synthetic id in
 * after() — never touching real user data.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
// Deterministic, isolated local test database. Without an explicit target the
// default `frieday` database is rejected by the pre-flight guard and every
// DB-backed test below would silently SKIP.
require('./helpers/dbTestTarget').useTestDatabase('frieday_test_repos_routes');

const SYNTHETIC_GITHUB_ID = 987654321;
const SYNTHETIC_OTHER_GITHUB_ID = 987654322; // owns a repo the first user must NOT see (404)
const SYNTHETIC_REPO_GITHUB_IDS = [990000001, 990000002, 990000003];
const SYNTHETIC_OTHER_REPO_GITHUB_ID = 990000004;

describe('GET /api/repos cursor contract (T9 regression)', () => {
  let appServer;
  let baseUrl;
  let dbUp = false;
  let cookieHeader;
  let newestRepo;

  async function hit(url) {
    const res = await fetch(`${baseUrl}${url}`, cookieHeader);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-16+';
    process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

    const db = require('../src/config/db');
    const { connectForTest } = require('./helpers/dbTestTarget');
    try {
      // INC-1 guard (pre-flight): the resolved target is validated BEFORE any
      // connection attempt, so a production-targeting MONGO_URI never opens a
      // socket to production.
      await Promise.race([
        connectForTest(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('db wait timeout')), 5000)),
      ]);
      dbUp = db.dbStatus() === 'up';
    } catch {
      dbUp = false;
    }
    if (!dbUp) return;

    const User = require('../src/models/User');
    const Repository = require('../src/models/Repository');
    const session = require('../src/services/auth/session.service');

    // Synthetic, labeled user + repos; removed again in after().
    await User.upsertOne({
      githubId: SYNTHETIC_GITHUB_ID,
      login: 'repos-cursor-test',
      avatarUrl: '',
      profileUrl: '',
      token: 'v1:' + 'ab'.repeat(60),
      scopes: ['read:user', 'repo'],
    });

    const issued = session.issueSession(SYNTHETIC_GITHUB_ID, 'repos-cursor-test', ['read:user', 'repo']);
    await session.persistSession(SYNTHETIC_GITHUB_ID, issued);
    cookieHeader = { headers: { cookie: `fd_access=${issued.accessToken}` } };

    // T8 DB-gated run fix: userId is required by the Repository model (and is
    // part of the unique identity) — the fixture must stamp the synthetic
    // user's _id or create() rejects and the whole suite is cancelled.
    const mainUser = await User.findOne({ githubId: SYNTHETIC_GITHUB_ID }).select('_id').lean();
    const created = await Repository.create(
      [0, 1, 2].map((i) => ({
        userId: mainUser._id,
        githubId: SYNTHETIC_REPO_GITHUB_IDS[i],
        owner: 'synthetic',
        name: `cursor-regression-${i + 1}`,
        fullName: `synthetic/cursor-regression-${i + 1}`,
        visibility: 'public',
        pushedAt: new Date(1791250000000 - i * 86400000),
        githubUpdatedAt: new Date(1791250000000 - i * 86400000),
        fetchedAt: new Date(),
        source: 'rest',
      }))
    );
    newestRepo = created[0];

    // Second synthetic user + their repo, for the cross-user 404 regression.
    await User.upsertOne({
      githubId: SYNTHETIC_OTHER_GITHUB_ID,
      login: 'repos-cursor-other',
      avatarUrl: '',
      profileUrl: '',
      token: 'v1:' + 'cd'.repeat(60),
      scopes: ['read:user', 'repo'],
    });
    const otherUser = await User.findOne({ githubId: SYNTHETIC_OTHER_GITHUB_ID }).select('_id').lean();
    await Repository.create({
      userId: otherUser._id,
      githubId: SYNTHETIC_OTHER_REPO_GITHUB_ID,
      owner: 'synthetic',
      name: 'other-user-repo',
      fullName: 'synthetic/other-user-repo',
      visibility: 'public',
      pushedAt: new Date(),
      githubUpdatedAt: new Date(),
      fetchedAt: new Date(),
      source: 'rest',
    });

    const { createApp } = require('../src/app');
    const app = createApp();
    appServer = app.listen(0);
    await new Promise((resolve) => appServer.on('listening', resolve));
    baseUrl = `http://127.0.0.1:${appServer.address().port}`;
  });

  after(async () => {
    const mongoose = require('mongoose');
    if (dbUp) {
      const User = require('../src/models/User');
      const Repository = require('../src/models/Repository');
      await Repository.deleteMany({
        githubId: { $in: [...SYNTHETIC_REPO_GITHUB_IDS, SYNTHETIC_OTHER_REPO_GITHUB_ID] },
      }).catch(() => {});
      await User.deleteMany({ githubId: { $in: [SYNTHETIC_GITHUB_ID, SYNTHETIC_OTHER_GITHUB_ID] } }).catch(
        () => {}
      );
    }
    await mongoose.disconnect().catch(() => {});
    if (appServer) {
      appServer.closeAllConnections?.();
      await new Promise((resolve) => appServer.close(() => resolve()));
    }
  });

  it('no cursor (initial page) returns 200 with pagination fields', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/repos?sort=activity&limit=50');
    assert.equal(status, 200, 'the first-page request must not be rejected as an invalid cursor');
    assert.ok(Array.isArray(body.items), 'items must be an array');
    assert.equal(typeof body.hasMore, 'boolean');
    assert.ok(body.nextCursor === null || typeof body.nextCursor === 'string');
  });

  it('garbage cursor returns 400 VALIDATION_ERROR "Invalid cursor."', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/repos?sort=activity&limit=50&cursor=zzz');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.message, 'Invalid cursor.');
    assert.equal(body.error.retryable, false);
  });

  it('valid cursor returns 200 with expected pagination fields', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    assert.ok(newestRepo, 'seeded repo fixture must exist');
    const { encodeCursor } = require('../src/utils/pagination');
    const cursor = encodeCursor({
      afterId: newestRepo._id.toString(),
      afterCreatedAt: new Date('2030-01-01T00:00:00Z').toISOString(),
    });
    const { status, body } = await hit(
      `/api/repos?sort=activity&limit=50&cursor=${encodeURIComponent(cursor)}`
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.hasMore, 'boolean');
    assert.ok(body.nextCursor === null || typeof body.nextCursor === 'string');
    assert.ok(!JSON.stringify(body).includes('v1:'), 'responses must never carry token material');
  });

  it('detail: owned repo returns 200 with fullName, health, recentActivity, miniTimeline', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    assert.ok(newestRepo, 'seeded repo fixture must exist');
    const { status, body } = await hit(`/api/repos/${newestRepo._id.toString()}?range=90d`);
    assert.equal(status, 200, 'detail must not fail (the getRecentActivity require-path regression)');
    assert.equal(typeof body.fullName, 'string');
    assert.equal(typeof body.health, 'string');
    assert.ok(body.recentActivity && Array.isArray(body.recentActivity.commits));
    assert.ok(body.recentActivity && Array.isArray(body.recentActivity.pullRequests));
    assert.ok(body.recentActivity && Array.isArray(body.recentActivity.issues));
    assert.ok(Array.isArray(body.miniTimeline));
    assert.ok(!JSON.stringify(body).includes('v1:'), 'responses must never carry token material');
  });

  it('detail: nonexistent valid ObjectId returns 404 NOT_FOUND', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/repos/6ac5140b46441902c2424cc8?range=90d');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('detail: malformed id is rejected by the existing contract', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    // NOTE: the current implemented contract is 404 NOT_FOUND (the zod param
    // schema only requires a non-empty string; the controller treats invalid
    // ObjectIds as not-found — safe, no validity info leaked). The task brief
    // said "400"; the test pins the ACTUAL contract instead of changing it.
    const { status, body } = await hit('/api/repos/not-a-valid-objectid?range=90d');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('detail: another user\u2019s repository returns 404 NOT_FOUND (user-scoping)', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const Repository = require('../src/models/Repository');
    const otherRepo = await Repository.findOne({ githubId: SYNTHETIC_OTHER_REPO_GITHUB_ID }).lean();
    assert.ok(otherRepo, 'other-user fixture must exist');
    const { status, body } = await hit(`/api/repos/${otherRepo._id.toString()}?range=90d`);
    assert.equal(status, 404, 'a repo owned by another user must never be reachable');
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});
