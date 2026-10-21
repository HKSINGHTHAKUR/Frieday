/**
 * Timeline route tests (T5.1 / T9 regression) — real Express stack.
 *
 * Regression coverage for the confirmed "rangeStart is not a function" defect:
 * timeline.routes.js destructured `rangeStart` from ../utils/dates, which does
 * not export it, so EVERY repoId request returned 500 (T9 fix #7). The repo
 * filter path (getRepoBuckets) is now pinned: owned repoId → 200.
 *
 * DB-gated per the established pattern (auth.test.js / repos.routes.test.js):
 * connect via the existing config/db (5s race), skip with an explicit reason
 * when MongoDB is unavailable. Synthetic rows are labeled and cleaned up in
 * after(). Garbage-repoId behavior (500 BSONError) is intentionally NOT
 * asserted here — it is the separately tracked F3 defect, unchanged by this
 * task.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
// Deterministic, isolated local test database. Without an explicit target the
// default `frieday` database is rejected by the pre-flight guard and every
// DB-backed test below would silently SKIP.
require('./helpers/dbTestTarget').useTestDatabase('frieday_test_timeline_routes');

const SYNTHETIC_GITHUB_ID = 987654321;
const SYNTHETIC_REPO_GITHUB_ID = 990000005;

describe('GET /api/timeline route contract (T9 regression)', () => {
  let appServer;
  let baseUrl;
  let dbUp = false;
  let cookieHeader;
  let ownedRepo;

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

    await User.upsertOne({
      githubId: SYNTHETIC_GITHUB_ID,
      login: 'timeline-route-test',
      avatarUrl: '',
      profileUrl: '',
      token: 'v1:' + 'ab'.repeat(60),
      scopes: ['read:user', 'repo'],
    });

    const issued = session.issueSession(SYNTHETIC_GITHUB_ID, 'timeline-route-test', ['read:user', 'repo']);
    await session.persistSession(SYNTHETIC_GITHUB_ID, issued);
    cookieHeader = { headers: { cookie: `fd_access=${issued.accessToken}` } };

    const user = await User.findOne({ githubId: SYNTHETIC_GITHUB_ID }).select('_id').lean();
    await Repository.create({
      userId: user._id,
      githubId: SYNTHETIC_REPO_GITHUB_ID,
      owner: 'synthetic',
      name: 'timeline-route-regression',
      fullName: 'synthetic/timeline-route-regression',
      visibility: 'public',
      pushedAt: new Date(),
      githubUpdatedAt: new Date(),
      fetchedAt: new Date(),
      source: 'rest',
    });
    ownedRepo = await Repository.findOne({ userId: user._id }).lean();

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
      await Repository.deleteMany({ githubId: SYNTHETIC_REPO_GITHUB_ID }).catch(() => {});
      await User.deleteOne({ githubId: SYNTHETIC_GITHUB_ID }).catch(() => {});
    }
    await mongoose.disconnect().catch(() => {});
    if (appServer) {
      appServer.closeAllConnections?.();
      await new Promise((resolve) => appServer.close(() => resolve()));
    }
  });

  it('timeline without repoId returns 200 with a buckets array', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/timeline?range=30d&granularity=day');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.buckets));
  });

  it('owned repoId returns 200 (fix for the rangeStart binding regression)', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    assert.ok(ownedRepo, 'owned repo fixture must exist');
    const { status, body } = await hit(
      `/api/timeline?range=30d&repoId=${ownedRepo._id.toString()}&granularity=day`
    );
    assert.equal(status, 200, 'a repoId-filtered timeline must not 500');
    assert.ok(Array.isArray(body.buckets));
  });

  it('invalid range returns 400 VALIDATION_ERROR', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/timeline?range=bogus');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('invalid granularity returns 400 VALIDATION_ERROR', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/timeline?range=30d&granularity=bogus');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('malformed repoId returns 400 VALIDATION_ERROR (F3: never 500)', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    for (const bad of ['not-an-object-id', 'abc', '50-char-invalid-value-xxxxxxxxxxxxxxxxxxx']) {
      const { status, body } = await hit(
        `/api/timeline?range=30d&granularity=day&repoId=${encodeURIComponent(bad)}`
      );
      assert.equal(status, 400, `malformed repoId "${bad}" must be 400`);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
      assert.ok(!/mongo|bson|cast/i.test(JSON.stringify(body)), 'no raw driver error leakage');
    }
  });

  it('valid-but-nonexistent repoId keeps the existing 200 zero-bucket behavior', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit(
      '/api/timeline?range=30d&granularity=day&repoId=000000000000000000000000'
    );
    assert.equal(status, 200, 'a valid nonexistent repoId is not a validation error');
    assert.ok(Array.isArray(body.buckets));
    assert.ok(
      body.buckets.every((b) => (b.commits ?? 0) === 0),
      'no fabricated activity'
    );
  });
});
