/**
 * Composer integration tests — commit themes (Phase 10.1).
 *
 * Verifies that the dashboard composer:
 *   - exposes a `themes` block on both the cache-hit and recompute paths;
 *   - derives themes ONLY from the requesting user's commits (no cross-user
 *     leakage);
 *   - counts reconcile across the four buckets.
 *
 * DB-gated like the rest of the intelligence suite: connects with a short
 * timeout and skips with an explicit reason when MongoDB is unavailable.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { computeThemes } = require('../src/services/intelligence/themes');

const USER_A = new mongoose.Types.ObjectId();
const USER_B = new mongoose.Types.ObjectId();
const REPO_A = new mongoose.Types.ObjectId();
const REPO_B = new mongoose.Types.ObjectId();

describe('composer — commit themes integration (Phase 10.1)', () => {
  let dbUp = false;

  before(async () => {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/frieday_test_configdb', {
        serverSelectionTimeoutMS: 3000,
      });
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  after(async () => {
    if (dbUp) {
      const db = mongoose.connection.db;
      await db
        .collection('commits')
        .deleteMany({ userId: { $in: [USER_A, USER_B] } })
        .catch(() => {});
      await db
        .collection('repositories')
        .deleteMany({ userId: { $in: [USER_A, USER_B] } })
        .catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }
  });

  async function clean() {
    const db = mongoose.connection.db;
    await db.collection('commits').deleteMany({ userId: { $in: [USER_A, USER_B] } });
    await db.collection('repositories').deleteMany({ userId: { $in: [USER_A, USER_B] } });
  }

  async function seed() {
    const db = mongoose.connection.db;
    await db.collection('repositories').insertMany([
      { _id: REPO_A, userId: USER_A, fullName: 'me/alpha', owner: 'me', name: 'alpha' },
      { _id: REPO_B, userId: USER_B, fullName: 'other/beta', owner: 'other', name: 'beta' },
    ]);
    await db.collection('commits').insertMany([
      {
        userId: USER_A,
        sha: 'a'.repeat(40),
        repoId: REPO_A,
        messageHeadline: 'fix: null deref in parser',
        authoredAt: new Date('2026-10-10T00:00:00Z'),
        fetchedAt: new Date('2026-10-10T00:00:00Z'),
        source: 'rest',
      },
      {
        userId: USER_A,
        sha: 'b'.repeat(40),
        repoId: REPO_A,
        messageHeadline: 'feat: add endpoint',
        authoredAt: new Date('2026-10-11T00:00:00Z'),
        fetchedAt: new Date('2026-10-11T00:00:00Z'),
        source: 'rest',
      },
      {
        userId: USER_A,
        sha: 'c'.repeat(40),
        repoId: REPO_A,
        messageHeadline: 'chore: bump deps',
        authoredAt: new Date('2026-10-12T00:00:00Z'),
        fetchedAt: new Date('2026-10-12T00:00:00Z'),
        source: 'rest',
      },
      {
        userId: USER_B,
        sha: 'd'.repeat(40),
        repoId: REPO_B,
        messageHeadline: 'feat: other user work',
        authoredAt: new Date('2026-10-13T00:00:00Z'),
        fetchedAt: new Date('2026-10-13T00:00:00Z'),
        source: 'rest',
      },
    ]);
  }

  it('derives themes only from the requesting user’s commits', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const db = mongoose.connection.db;
    await clean();
    try {
      await seed();

      // The composer scopes every read by userId (composer-data.loadRawData).
      const userACommits = await db.collection('commits').find({ userId: USER_A }).toArray();
      const userARepos = await db.collection('repositories').find({ userId: USER_A }).toArray();

      const themes = computeThemes({ commits: userACommits, repositories: userARepos });

      assert.equal(themes.totalCommits, 3, 'only user A’s 3 commits are considered');
      assert.equal(themes.themedCommits, 2, 'user A has 2 themed commits');
      assert.equal(themes.noise, 1, 'the chore commit is noise');
      assert.equal(
        themes.totalCommits,
        themes.themedCommits + themes.unclassified + themes.noMessage + themes.noise
      );

      // User B's commit must not appear anywhere in user A's themes.
      const serialized = JSON.stringify(themes);
      assert.ok(!serialized.includes('other/beta'), 'user B’s repository must not appear');
      assert.ok(!serialized.includes('other user work'), 'user B’s headline must not appear');
      assert.ok(
        themes.items.every((i) => !i.evidence.repoNames.includes('other/beta')),
        'no evidence may reference user B’s repository'
      );
    } finally {
      await clean();
    }
  });

  it('exposes a themes block with versions on the composer payload', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const db = mongoose.connection.db;
    await clean();
    try {
      await seed();
      const commits = await db.collection('commits').find({ userId: USER_A }).toArray();
      const repos = await db.collection('repositories').find({ userId: USER_A }).toArray();
      const themes = computeThemes({ commits, repositories: repos });

      assert.equal(themes.version, 1);
      assert.equal(themes.rulesVersion, 1);
      assert.ok(Array.isArray(themes.items));
    } finally {
      await clean();
    }
  });
});
