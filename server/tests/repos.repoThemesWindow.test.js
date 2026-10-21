/**
 * Phase 10.2 — the per-repository commit window (regression suite).
 *
 * The defect this locks down: the commit read applied ONE global limit to a
 * globally-sorted result set. The busiest repository therefore consumed the
 * entire budget and quiet repositories were left with ZERO commits — their
 * theme chip silently disappeared from the UI, with no error anywhere.
 *
 * Every case below runs against a REAL local MongoDB (an isolated
 * `frieday_test_*` database), because the defect is in the query plan, not in
 * a mock. The database is pinned explicitly, so the suite never inherits the
 * root `.env`'s production Atlas URI and never silently skips.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
require('./helpers/dbTestTarget').useTestDatabase('frieday_test_repo_themes_window');

const { getCommitsByRepoIds } = require('../src/services/repos/repos.service');

/** Synthetic, labelled user id — never real user data. */
const USER_ID = new mongoose.Types.ObjectId('64b64b64b64b64b64b64b64b');
const OTHER_USER_ID = new mongoose.Types.ObjectId('64b64b64b64b64b64b64b64c');
const REPO_BUSY = new mongoose.Types.ObjectId('64b64b64b64b64b64b64b64d');
const REPO_QUIET = new mongoose.Types.ObjectId('64b64b64b64b64b64b64b64e');
const REPO_OFF_PAGE = new mongoose.Types.ObjectId('64b64b64b64b64b64b64b64f');

/** The ingestion ceiling — the per-repository window. */
const PER_REPO = 500;

let dbUp = false;
let Commit;

function shaFor(prefix, n) {
  return `${prefix}${String(n).padStart(39, '0')}`;
}

/**
 * Seed commits for a repository.
 * @param {object} opts
 * @param {number} opts.count - how many commits
 * @param {number} opts.ageDays - how old the OLDEST commit is; the newest is now
 * @param {string} opts.headline - the commit headline
 * @param {boolean} [opts.withBody] - include a commit body (must never be read)
 */
function commitRows(repoId, { count, ageDays = 0, headline = 'fix: synthetic work', userId = USER_ID }) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    rows.push({
      userId,
      repoId,
      sha: shaFor(String.fromCharCode(97 + (i % 26)), i),
      messageHeadline: headline,
      messageFull: 'SYNTHETIC COMMIT BODY — must never be read',
      authoredAt: new Date(now - (ageDays * 86400000 + i * 1000)),
      fetchedAt: new Date(),
      source: 'rest',
    });
  }
  return rows;
}

describe('getCommitsByRepoIds — per-repository window (Phase 10.2 regression)', () => {
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

    Commit = require('../src/models/Commit');
    await Commit.deleteMany({ userId: { $in: [USER_ID, OTHER_USER_ID] } });

    // A BUSY repository (1200 commits) and a QUIET repository (50 commits,
    // all OLDER than the busy one's). Under the old global limit the quiet
    // repository received NOTHING.
    await Commit.create([
      ...commitRows(REPO_BUSY, { count: 1200, ageDays: 0 }),
      ...commitRows(REPO_QUIET, { count: 50, ageDays: 30, headline: 'feat: quiet repo work' }),
      // Another user's commits on the SAME repository: must never appear.
      ...commitRows(REPO_QUIET, {
        count: 40,
        ageDays: 0,
        headline: 'feat: OTHER USER work',
        userId: OTHER_USER_ID,
      }),
      // A repository that is NOT on the requested page.
      ...commitRows(REPO_OFF_PAGE, { count: 300, ageDays: 0, headline: 'feat: off page work' }),
    ]);
  });

  after(async () => {
    if (dbUp && Commit) {
      await Commit.deleteMany({ userId: { $in: [USER_ID, OTHER_USER_ID] } }).catch(() => {});
    }
    await mongoose.disconnect().catch(() => {});
  });

  it('1. a busy repository cannot consume a quiet repository’s budget', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const grouped = await getCommitsByRepoIds(USER_ID.toString(), [
      REPO_BUSY.toString(),
      REPO_QUIET.toString(),
    ]);

    const quiet = grouped.get(REPO_QUIET.toString()) || [];
    assert.equal(
      quiet.length,
      50,
      'the quiet repository must keep ALL 50 of its commits — the old global limit starved it'
    );
  });

  it('2. a repository with 50 genuine themed commits keeps its evidence', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const grouped = await getCommitsByRepoIds(USER_ID.toString(), [
      REPO_BUSY.toString(),
      REPO_QUIET.toString(),
    ]);
    const quiet = grouped.get(REPO_QUIET.toString()) || [];
    const headlines = quiet.map((c) => c.messageHeadline);
    assert.ok(
      headlines.includes('feat: quiet repo work'),
      'the quiet repository must retain its genuine themed commits'
    );
  });

  it('3. results are user-scoped and page-scoped', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const grouped = await getCommitsByRepoIds(USER_ID.toString(), [
      REPO_BUSY.toString(),
      REPO_QUIET.toString(),
    ]);

    // Another user's commits on the same repository must be absent.
    const serialized = JSON.stringify([...grouped.values()]);
    assert.ok(!serialized.includes('OTHER USER work'), "another user's commits must never appear");

    // A repository that is not on the page must not be queried at all.
    assert.equal(grouped.has(REPO_OFF_PAGE.toString()), false, 'an off-page repository must be absent');
    assert.ok(!serialized.includes('off page work'), 'off-page commits must never be returned');
  });

  it('4. messageFull is never retrieved or returned', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const grouped = await getCommitsByRepoIds(USER_ID.toString(), [
      REPO_BUSY.toString(),
      REPO_QUIET.toString(),
    ]);
    for (const [repoId, list] of grouped) {
      for (const c of list) {
        assert.equal(c.messageFull, undefined, `messageFull must never be read (repository ${repoId})`);
      }
    }
    assert.ok(
      !JSON.stringify([...grouped.values()]).includes('SYNTHETIC COMMIT BODY'),
      'no commit body may appear in the theme map'
    );
  });

  it('5. repository results are deterministic', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const ids = [REPO_BUSY.toString(), REPO_QUIET.toString()];
    const first = await getCommitsByRepoIds(USER_ID.toString(), ids);
    const second = await getCommitsByRepoIds(USER_ID.toString(), ids);
    assert.deepEqual(
      [...first.entries()].map(([k, v]) => [k, v.map((c) => c.sha)]),
      [...second.entries()].map(([k, v]) => [k, v.map((c) => c.sha)]),
      'the same data must always produce the same window'
    );
  });

  it('6. a repository with zero commits behaves correctly', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const empty = new mongoose.Types.ObjectId('64b64b64b64b64b64b64b650');
    const grouped = await getCommitsByRepoIds(USER_ID.toString(), [empty.toString()]);
    const list = grouped.get(empty.toString());
    assert.ok(list === undefined || list.length === 0, 'a repository with no commits has no commits');
  });

  it('7. the maximum bound is enforced independently for every repository', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const grouped = await getCommitsByRepoIds(USER_ID.toString(), [
      REPO_BUSY.toString(),
      REPO_QUIET.toString(),
    ]);
    const busy = grouped.get(REPO_BUSY.toString()) || [];
    const quiet = grouped.get(REPO_QUIET.toString()) || [];

    assert.equal(busy.length, PER_REPO, `the busy repository is capped at ${PER_REPO}`);
    assert.equal(quiet.length, 50, 'the quiet repository keeps its own commits — the cap is per repository');
    assert.ok(
      busy.length <= PER_REPO && quiet.length <= PER_REPO,
      'no repository may exceed the per-repository bound'
    );
  });

  it('8. the window keeps the MOST RECENT commits of each repository', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const grouped = await getCommitsByRepoIds(USER_ID.toString(), [REPO_BUSY.toString()]);
    const busy = grouped.get(REPO_BUSY.toString()) || [];
    for (let i = 1; i < busy.length; i++) {
      assert.ok(
        new Date(busy[i].authoredAt) <= new Date(busy[i - 1].authoredAt),
        'commits must be ordered newest-first'
      );
    }
  });

  it('the repository detail endpoint never returns a commit body', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    // prd.md §18: commit bodies are never exposed. GET /api/repos/:id renders
    // the activity list from the headline alone, so the body must not be
    // selected into the response.
    const { getRecentActivity } = require('../src/services/repos/repos.service');
    const activity = await getRecentActivity(USER_ID.toString(), REPO_QUIET, '90d');
    for (const commit of activity.commits) {
      assert.equal(
        commit.messageFull,
        undefined,
        'the commit body must never be selected into the repository detail response'
      );
      assert.ok(commit.sha, 'the commit identity must still be returned');
      assert.ok('authoredAt' in commit, 'the commit date must still be returned');
    }
    assert.ok(
      !JSON.stringify(activity.commits).includes('SYNTHETIC COMMIT BODY'),
      'no commit body may appear in the repository detail response'
    );
  });

  it('the health rule still sees each repository’s most recent commit', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    // The window always contains the newest commit of every repository, so the
    // health rule (which needs only the most recent commit date) is unaffected
    // by the bounded window.
    const grouped = await getCommitsByRepoIds(USER_ID.toString(), [
      REPO_BUSY.toString(),
      REPO_QUIET.toString(),
    ]);
    const busy = grouped.get(REPO_BUSY.toString()) || [];
    const quiet = grouped.get(REPO_QUIET.toString()) || [];
    assert.ok(busy.length > 0 && quiet.length > 0, 'both repositories have a window');
    const newestOverall = await Commit.find({ userId: USER_ID, repoId: REPO_QUIET })
      .sort({ authoredAt: -1 })
      .limit(1)
      .lean();
    assert.equal(
      new Date(quiet[0].authoredAt).getTime(),
      new Date(newestOverall[0].authoredAt).getTime(),
      "the window's newest commit must be the repository's actual newest commit"
    );
  });
});
