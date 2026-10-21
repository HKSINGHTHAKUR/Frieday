/**
 * Per-repository commit themes — API contract + cross-user isolation
 * (Phase 10.2).
 *
 * Verifies that GET /api/repos returns a `repoThemes` map:
 *   - one entry per repository on the page, keyed by repository id;
 *   - per-theme counts, shares over the themed-commit denominator, confidence,
 *     and the unclassified / no-message / maintenance buckets;
 *   - counts that reconcile per repository;
 *   - bounded evidence (no commit bodies, no unbounded lists);
 *   - NO cross-user leakage: another user's repository/commits never appear.
 *
 * DB-gated per the established pattern (repos.routes.test.js): connect to an
 * isolated local test database, skip with an explicit reason when MongoDB is
 * unavailable. Synthetic rows are labelled and cleaned up by synthetic id in
 * after() — never touching real user data.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

// Deterministic, isolated local test database. Without this the suite fell
// back to the default `mongodb://127.0.0.1:27017/frieday`, which the
// pre-flight guard REJECTS — so every test below silently SKIPPED and the
// suite reported green while exercising nothing. Pin the target before
// anything reads the environment.
require('./helpers/dbTestTarget').useTestDatabase('frieday_test_repo_themes');

const SYNTHETIC_GITHUB_ID = 987654331;
const SYNTHETIC_OTHER_GITHUB_ID = 987654332;
const SYNTHETIC_REPO_GITHUB_IDS = [990000011, 990000012];
const SYNTHETIC_OTHER_REPO_GITHUB_ID = 990000013;

describe('GET /api/repos repoThemes contract (Phase 10.2)', () => {
  let appServer;
  let baseUrl;
  let dbUp = false;
  let cookieHeader;
  let otherCookieHeader;
  let mainUserId;

  async function hit(url, cookie = cookieHeader) {
    const res = await fetch(`${baseUrl}${url}`, { headers: { cookie } });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  before(async () => {
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
    const Commit = require('../src/models/Commit');
    const session = require('../src/services/auth/session.service');

    await User.upsertOne({
      githubId: SYNTHETIC_GITHUB_ID,
      login: 'repo-themes-test',
      avatarUrl: '',
      profileUrl: '',
      token: 'v1:' + 'ab'.repeat(60),
      scopes: ['read:user', 'repo'],
    });
    const mainUser = await User.findOne({ githubId: SYNTHETIC_GITHUB_ID }).select('_id').lean();
    mainUserId = mainUser._id;

    const issued = session.issueSession(SYNTHETIC_GITHUB_ID, 'repo-themes-test', ['read:user', 'repo']);
    await session.persistSession(SYNTHETIC_GITHUB_ID, issued);
    cookieHeader = `fd_access=${issued.accessToken}`;

    // A second user, whose repository + commits must never leak.
    await User.upsertOne({
      githubId: SYNTHETIC_OTHER_GITHUB_ID,
      login: 'repo-themes-other',
      avatarUrl: '',
      profileUrl: '',
      token: 'v1:' + 'cd'.repeat(60),
      scopes: ['read:user', 'repo'],
    });
    const otherUser = await User.findOne({ githubId: SYNTHETIC_OTHER_GITHUB_ID }).select('_id').lean();
    const otherIssued = session.issueSession(SYNTHETIC_OTHER_GITHUB_ID, 'repo-themes-other', [
      'read:user',
      'repo',
    ]);
    await session.persistSession(SYNTHETIC_OTHER_GITHUB_ID, otherIssued);
    otherCookieHeader = `fd_access=${otherIssued.accessToken}`;

    const repos = await Repository.create(
      SYNTHETIC_REPO_GITHUB_IDS.map((githubId, i) => ({
        userId: mainUser._id,
        githubId,
        owner: 'synthetic',
        name: `themes-repo-${i + 1}`,
        fullName: `synthetic/themes-repo-${i + 1}`,
        visibility: 'public',
        pushedAt: new Date(1791250000000 - i * 86400000),
        githubUpdatedAt: new Date(1791250000000 - i * 86400000),
        fetchedAt: new Date(),
        source: 'rest',
      }))
    );
    const otherRepo = await Repository.create({
      userId: otherUser._id,
      githubId: SYNTHETIC_OTHER_REPO_GITHUB_ID,
      owner: 'synthetic',
      name: 'other-user-themes-repo',
      fullName: 'synthetic/other-user-themes-repo',
      visibility: 'public',
      pushedAt: new Date(),
      githubUpdatedAt: new Date(),
      fetchedAt: new Date(),
      source: 'rest',
    });
    const sha = (n) => String(n).padStart(40, 'a');
    const created = await Commit.create([
      {
        userId: mainUser._id,
        repoId: repos[0]._id,
        sha: sha(1),
        messageHeadline: 'fix: null deref in parser',
        messageFull: 'SECRET BODY ONE',
        authoredAt: new Date('2026-10-10T00:00:00Z'),
        fetchedAt: new Date('2026-10-10T00:00:00Z'),
        source: 'rest',
      },
      {
        userId: mainUser._id,
        repoId: repos[0]._id,
        sha: sha(2),
        messageHeadline: 'fix: race in sync worker',
        authoredAt: new Date('2026-10-11T00:00:00Z'),
        fetchedAt: new Date('2026-10-11T00:00:00Z'),
        source: 'rest',
      },
      {
        userId: mainUser._id,
        repoId: repos[0]._id,
        sha: sha(3),
        messageHeadline: 'chore: bump deps',
        authoredAt: new Date('2026-10-12T00:00:00Z'),
        fetchedAt: new Date('2026-10-12T00:00:00Z'),
        source: 'rest',
      },
      {
        userId: mainUser._id,
        repoId: repos[1]._id,
        sha: sha(4),
        messageHeadline: 'docs: update the readme',
        authoredAt: new Date('2026-10-13T00:00:00Z'),
        fetchedAt: new Date('2026-10-13T00:00:00Z'),
        source: 'rest',
      },
      {
        userId: otherUser._id,
        repoId: otherRepo._id,
        sha: sha(5),
        messageHeadline: 'feat: other user secret work',
        messageFull: 'SECRET BODY OTHER',
        authoredAt: new Date('2026-10-14T00:00:00Z'),
        fetchedAt: new Date('2026-10-14T00:00:00Z'),
        source: 'rest',
      },
    ]);
    assert.equal(created.length, 5, 'the synthetic commit fixtures must all be written');

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
      const Commit = require('../src/models/Commit');
      await Commit.deleteMany({ userId: { $in: [mainUserId] } }).catch(() => {});
      await Repository.deleteMany({
        githubId: { $in: [...SYNTHETIC_REPO_GITHUB_IDS, SYNTHETIC_OTHER_REPO_GITHUB_ID] },
      }).catch(() => {});
      await User.deleteMany({
        githubId: { $in: [SYNTHETIC_GITHUB_ID, SYNTHETIC_OTHER_GITHUB_ID] },
      }).catch(() => {});
    }
    await mongoose.disconnect().catch(() => {});
    if (appServer) {
      appServer.closeAllConnections?.();
      await new Promise((resolve) => appServer.close(() => resolve()));
    }
  });

  it('the theme map is opt-in: it is omitted unless includeThemes=true', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    // The theme map is the largest part of the response (measured: 85% of the
    // bytes for a small page, 94% for a 50-repo page). A consumer that only
    // needs the repository list — the Timeline page's repository filter — must
    // not pay for it, so the map is opt-in.
    const withoutThemes = await hit('/api/repos?sort=activity&limit=50');
    assert.equal(withoutThemes.status, 200);
    assert.equal(
      withoutThemes.body.repoThemes,
      undefined,
      'the theme map must be omitted unless it is explicitly requested'
    );
    assert.ok(Array.isArray(withoutThemes.body.items), 'items must still be returned');
    assert.equal(typeof withoutThemes.body.hasMore, 'boolean');

    const withThemes = await hit('/api/repos?sort=activity&limit=50&includeThemes=true');
    assert.equal(withThemes.status, 200);
    assert.ok(
      withThemes.body.repoThemes && typeof withThemes.body.repoThemes === 'object',
      'the theme map must be present when it is requested'
    );
  });

  it('rejects a malformed includeThemes value', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/repos?sort=activity&limit=50&includeThemes=maybe');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('returns a repoThemes map with one entry per repository on the page', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/repos?sort=activity&limit=50&includeThemes=true');
    assert.equal(status, 200);
    assert.ok(body.repoThemes && typeof body.repoThemes === 'object', 'repoThemes must be present');

    for (const item of body.items) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(body.repoThemes, item.id),
        `repoThemes must contain an entry for ${item.id}`
      );
    }
  });

  it('per-repository entry exposes counts, shares, confidence and buckets', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { body } = await hit('/api/repos?sort=activity&limit=50&includeThemes=true');
    const entry = Object.values(body.repoThemes).find((e) => e.totalCommits > 0);
    assert.ok(entry, 'at least one repository must have commits');

    assert.equal(entry.version, 1);
    assert.equal(entry.rulesVersion, 1);
    assert.equal(typeof entry.themedCommits, 'number');
    assert.equal(typeof entry.unclassified, 'number');
    assert.equal(typeof entry.noMessage, 'number');
    assert.equal(typeof entry.noise, 'number');
    assert.ok(Array.isArray(entry.items));

    // Reconciliation per repository.
    assert.equal(
      entry.totalCommits,
      entry.themedCommits + entry.unclassified + entry.noMessage + entry.noise
    );

    // Shares are over the themed denominator and sum to 1.
    const shareSum = entry.items.reduce((s, i) => s + i.share, 0);
    if (entry.themedCommits > 0) {
      assert.ok(Math.abs(shareSum - 1) < 0.001, 'theme shares must sum to 1');
      for (const item of entry.items) {
        assert.ok(
          Math.abs(item.share - item.commitCount / entry.themedCommits) < 0.002,
          'share must be commitCount / themedCommits'
        );
        assert.ok(['High', 'Medium', 'Low'].includes(item.confidence));
      }
    }

    // Deterministic top theme.
    assert.ok(entry.topTheme === null || typeof entry.topTheme.theme === 'string');
  });

  it('never exposes commit bodies or another user’s data', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { body } = await hit('/api/repos?sort=activity&limit=50&includeThemes=true');
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('SECRET BODY'), 'commit bodies must never be exposed');
    assert.ok(!serialized.includes('other user secret work'), 'another user’s commits must not leak');
    assert.ok(!serialized.includes('other-user-themes-repo'), 'another user’s repo must not leak');
    assert.ok(!serialized.includes('v1:'), 'responses must never carry token material');
  });

  it('the other user sees only their own repository’s themes', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit(
      '/api/repos?sort=activity&limit=50&includeThemes=true',
      otherCookieHeader
    );
    assert.equal(status, 200);
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('themes-repo-1'), 'other user must not see this user’s repos');
    assert.ok(!serialized.includes('null deref in parser'), 'other user must not see this user’s commits');

    const otherEntry = Object.values(body.repoThemes)[0];
    assert.ok(otherEntry, 'the other user must have their own entry');
    assert.equal(otherEntry.totalCommits, 1);
    assert.equal(otherEntry.themedCommits, 1);
    assert.equal(otherEntry.topTheme.theme, 'Feature');
  });

  it('existing consumers are unaffected: items, nextCursor and hasMore keep their shape', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const { status, body } = await hit('/api/repos?sort=activity&limit=50&includeThemes=true');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.hasMore, 'boolean');
    assert.ok(body.nextCursor === null || typeof body.nextCursor === 'string');

    // A repository item keeps every pre-Phase-10.2 field.
    const item = body.items[0];
    for (const key of [
      'id',
      'githubId',
      'fullName',
      'owner',
      'name',
      'visibility',
      'primaryLanguage',
      'stars',
      'fork',
      'pushedAt',
      'updatedAt',
      'health',
      'daysSinceActivity',
      'lastActivityAt',
      'openPRs',
      'openIssues',
    ]) {
      assert.ok(key in item, `item must still expose "${key}"`);
    }
  });
});
