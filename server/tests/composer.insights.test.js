/**
 * Composer → insights wiring regression tests (T4.3).
 *
 * Guards the exact data path that was broken before the fix:
 * evaluateInsightsFromPayload reads the CURRENT-period metrics
 * (timeline/languages/focus/consistency/repoHealth) from `payload.raw.*`.
 * The bug read `payload.*` (undefined for the { raw, previous } shape the
 * composer passes), so current-period inputs silently fell back to empty
 * defaults: Activity Momentum reported currentCommits=0 and Consistency
 * reported activeDays=0 while Overview/Timeline showed real activity.
 *
 * These tests are DB-free (pure function) and mirror the composer's call
 * shape exactly.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { evaluateInsightsFromPayload } = require('../src/services/intelligence/composer-compute');
const { persistInsights } = require('../src/services/intelligence/composer-persist');
const Insight = require('../src/models/Insight');

function makeCommit(i, repoId = 'r1') {
  return {
    _id: `c${i}`,
    sha: `sha${i}`,
    authoredAt: new Date(Date.UTC(2026, 8, 1 + (i % 28))),
    repoId,
    messageHeadline: 'synthetic',
  };
}

function makeTimeline(totalCommits) {
  return [
    {
      bucketStart: new Date(Date.UTC(2026, 8, 1)),
      commits: totalCommits,
      prsOpened: 0,
      prsMerged: 0,
      issuesTouched: 0,
    },
  ];
}

function buildPayload({ currentCommits = 121, currentActiveDays = 25, previousCommits = 93 } = {}) {
  return {
    raw: {
      commits: Array.from({ length: currentCommits }, (_, i) => makeCommit(i)),
      pullRequests: [],
      issues: [],
      repositories: [{ _id: 'r1', fullName: 'owner/repo' }],
      timeline: makeTimeline(currentCommits),
      languages: { weightedBytes: {}, commitShare: {} },
      focus: [],
      consistency: { activeDays: currentActiveDays, currentStreak: 5, longestStreak: 12, gaps: [] },
      repoHealth: [],
    },
    previous: {
      commits: Array.from({ length: previousCommits }, (_, i) => makeCommit(i + 1000)),
      pullRequests: [],
      issues: [],
      repositories: [],
      timeline: makeTimeline(previousCommits),
      languages: { weightedBytes: {}, commitShare: {} },
      consistency: { activeDays: 10, currentStreak: 3, longestStreak: 8, gaps: [] },
      repoHealth: [],
    },
  };
}

function findInsight(insights, templateId) {
  return insights.find((i) => i.templateId === templateId);
}

describe('evaluateInsightsFromPayload (composer → evaluateInsights wiring)', () => {
  it('A: Activity Momentum currentCommits matches the canonical timeline (not 0)', () => {
    const insights = evaluateInsightsFromPayload(
      buildPayload({ currentCommits: 121, previousCommits: 93 }),
      '30d',
      new Date(),
      []
    );
    const m = findInsight(insights, 'activity_momentum');
    assert.ok(m, 'momentum insight should be emitted with real current data');
    assert.equal(m.metrics.currentCommits, 121, 'current commits must come from raw.timeline');
    assert.equal(m.metrics.previousCommits, 93, 'previous commits must come from previous.timeline');
    assert.equal(m.metrics.state, 'up', '121 vs 93 is an increase');
  });

  it('B: Consistency activeDays matches the canonical consistency (not 0)', () => {
    const insights = evaluateInsightsFromPayload(
      buildPayload({ currentActiveDays: 25 }),
      '30d',
      new Date(),
      []
    );
    const c = findInsight(insights, 'consistency');
    assert.ok(c, 'consistency insight should be emitted with real activity');
    assert.equal(c.metrics.activeDays, 25, 'activeDays must come from raw.consistency');
    assert.ok(c.text.includes('Active 25 of the last 30 days'), c.text);
  });

  it('C: range flows through into insight text (30d and 90d)', () => {
    const i30 = evaluateInsightsFromPayload(buildPayload({}), '30d', new Date(), []);
    const m30 = findInsight(i30, 'activity_momentum');
    assert.ok(m30.text.includes('vs prior 30d.'), m30.text);

    const i90 = evaluateInsightsFromPayload(buildPayload({}), '90d', new Date(), []);
    const m90 = findInsight(i90, 'activity_momentum');
    assert.ok(m90.text.includes('vs prior 90d.'), m90.text);
    const c90 = findInsight(i90, 'consistency');
    assert.ok(c90.text.includes('Active 25 of the last 90 days'), c90.text);
  });

  it('E: previous-period commits are computed from the previous timeline', () => {
    const insights = evaluateInsightsFromPayload(
      buildPayload({ currentCommits: 50, previousCommits: 200 }),
      '30d',
      new Date(),
      []
    );
    const m = findInsight(insights, 'activity_momentum');
    assert.ok(m);
    assert.equal(m.metrics.currentCommits, 50);
    assert.equal(m.metrics.previousCommits, 200);
    assert.equal(m.metrics.state, 'down', '50 vs 200 is a decrease');
  });

  it('F: empty activity still legitimately yields 0 / "No recorded activity"', () => {
    const insights = evaluateInsightsFromPayload(
      buildPayload({ currentCommits: 0, previousCommits: 0, currentActiveDays: 0 }),
      '30d',
      new Date(),
      []
    );
    assert.equal(
      findInsight(insights, 'activity_momentum'),
      undefined,
      'momentum suppressed when both periods are empty'
    );
    const c = findInsight(insights, 'consistency');
    assert.ok(c);
    assert.equal(c.metrics.activeDays, 0, 'zero activity stays zero');
    assert.ok(c.text.includes('No recorded activity in the last 30d.'), c.text);
  });

  it('G: re-evaluation with fresh data yields fresh non-zero metrics (not stuck on 0)', () => {
    const stale = evaluateInsightsFromPayload(
      buildPayload({ currentCommits: 0, previousCommits: 93, currentActiveDays: 0 }),
      '30d',
      new Date(),
      []
    );
    const staleM = findInsight(stale, 'activity_momentum');
    assert.equal(staleM.metrics.currentCommits, 0, 'a genuinely empty current period is 0');

    const fresh = evaluateInsightsFromPayload(
      buildPayload({ currentCommits: 121, previousCommits: 93, currentActiveDays: 25 }),
      '30d',
      new Date(),
      []
    );
    const freshM = findInsight(fresh, 'activity_momentum');
    assert.equal(freshM.metrics.currentCommits, 121, 'fresh data must produce fresh current commits');
    const freshC = findInsight(fresh, 'consistency');
    assert.equal(freshC.metrics.activeDays, 25);
  });
});

/**
 * FIND-1 reproduction: Project Health recompute/cache variance.
 *
 * Defect: evaluateProjectHealth emits one insight PER REPO that changed
 * health state, all sharing templateId 'project_health'. persistInsights
 * upserts with identity { userId, range, templateId } only, so all N
 * per-repo insights collapse to a single stored doc (last write wins).
 *
 * Variance:
 *   Fresh recompute response:  N project_health insights (one per repo)
 *   Cache-hit response:        1 project_health insight (deduped by templateId)
 *   Second recompute:          1 project_health insight (reads collapsed doc)
 *
 * Same data, different insight count depending on code path — a genuine
 * consistency defect, not expected behavior.
 */
describe('FIND-1: Project Health recompute/cache variance', () => {
  function buildHealthPayload(repoHealth, previousRepoHealth) {
    return {
      raw: {
        commits: [],
        pullRequests: [],
        issues: [],
        repositories: repoHealth.map((r) => ({
          _id: r.repoId,
          fullName: `owner/${r.repoName}`,
        })),
        timeline: [],
        languages: { weightedBytes: {}, commitShare: {} },
        focus: [],
        consistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
        repoHealth,
      },
      previous: {
        commits: [],
        pullRequests: [],
        issues: [],
        repositories: [],
        timeline: [],
        languages: { weightedBytes: {}, commitShare: {} },
        consistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
        repoHealth: previousRepoHealth,
      },
    };
  }

  it('emits N per-repo project_health insights on fresh recompute (N repos changed)', () => {
    const repoHealth = [
      { repoId: 'r1', repoName: 'repo1', health: 'active', daysSinceActivity: 2 },
      { repoId: 'r2', repoName: 'repo2', health: 'active', daysSinceActivity: 5 },
      { repoId: 'r3', repoName: 'repo3', health: 'active', daysSinceActivity: 1 },
    ];
    const previousRepoHealth = [
      { repoId: 'r1', health: 'quiet' },
      { repoId: 'r2', health: 'quiet' },
      { repoId: 'r3', health: 'quiet' },
    ];

    const insights = evaluateInsightsFromPayload(
      buildHealthPayload(repoHealth, previousRepoHealth),
      '30d',
      new Date(),
      []
    );

    const healthInsights = insights.filter((i) => i.templateId === 'project_health');
    assert.equal(
      healthInsights.length,
      3,
      'fresh recompute must return one project_health insight per repo (got ' + healthInsights.length + ')'
    );
    assert.ok(
      healthInsights.every((i) => i.metrics.repoId),
      'each project_health insight must carry its repoId in metrics'
    );
  });

  it('persistInsights upsert identity collapses N project_health to 1 doc (simulated)', () => {
    // Simulate persistInsights filter: { userId, range, templateId } — NO repoId
    const insights = [
      { templateId: 'project_health', metrics: { repoId: 'r1' } },
      { templateId: 'project_health', metrics: { repoId: 'r2' } },
      { templateId: 'project_health', metrics: { repoId: 'r3' } },
    ];

    const upsertFilters = insights.map((i) => ({
      userId: 'u1',
      range: '30d',
      templateId: i.templateId,
    }));

    // All three filters are identical — persistInsights would upsert to the
    // same document three times (last write wins).
    assert.equal(
      new Set(upsertFilters.map((f) => JSON.stringify(f))).size,
      1,
      'FIND-1 confirmed: all project_health upserts share the same identity'
    );
  });
});

/**
 * Regression test for the dashboard 500 (E11000 duplicate key on insights).
 *
 * Defect: persistInsights upserted per-repo project_health insights with
 * identity { userId, range, templateId } but repoId was missing from the
 * live unique index, so N per-repo insights collided on the same
 * (userId, range, templateId) key and the bulkWrite threw E11000, crashing
 * the dashboard with HTTP 500 for 30d/12m ranges.
 *
 * Fix: persistInsights now wipes { userId, range } before re-inserting, so
 * per-repo project_health insights for different repos can coexist.
 *
 * DB-gated: skips when MongoDB is unavailable.
 */
describe('persistInsights — per-repo project_health duplicate key (recomputed ranges)', () => {
  const TEST_USER_ID = new mongoose.Types.ObjectId();
  const TEST_REPO_ID_1 = new mongoose.Types.ObjectId();
  const TEST_REPO_ID_2 = new mongoose.Types.ObjectId();
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
      await mongoose.connection.db
        .collection('insights')
        .deleteMany({ userId: TEST_USER_ID })
        .catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }
  });

  async function insertProjectHealthInsight(db, repoId) {
    await db.collection('insights').insertOne({
      userId: TEST_USER_ID,
      range: '30d',
      templateId: 'project_health',
      repoId,
      generatedAt: new Date('2026-10-17T00:00:00.000Z'),
      title: 'Existing project health',
      text: 'Existing insight text',
      metrics: {
        repoId,
        repoName: 'existing/repo',
        previousHealth: 'quiet',
        currentHealth: 'active',
        daysSinceActivity: 5,
      },
      evidence: { repoIds: [repoId] },
      confidence: 'High',
    });
  }

  it('persistInsights inserts multiple per-repo project_health insights without duplicate key', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }

    // Seed an existing project_health insight for repo 1 (simulates stale cache).
    const db = mongoose.connection.db;
    await insertProjectHealthInsight(db, TEST_REPO_ID_1);

    try {
      // New insights for TWO different repos — previously this collided on
      // (userId, range, templateId) because repoId was missing from the live
      // index. With deleteMany + upsert, both insert cleanly.
      await persistInsights(
        TEST_USER_ID.toString(),
        '30d',
        [
          {
            templateId: 'project_health',
            title: 'Repo 1 revived',
            text: 'repo1 moved from quiet to active.',
            metrics: {
              repoId: TEST_REPO_ID_1.toString(),
              repoName: 'repo1',
              previousHealth: 'quiet',
              currentHealth: 'active',
              daysSinceActivity: 2,
            },
            evidence: { repoIds: [TEST_REPO_ID_1.toString()] },
            confidence: 'High',
          },
          {
            templateId: 'project_health',
            title: 'Repo 2 went quiet',
            text: 'repo2 moved from active to quiet.',
            metrics: {
              repoId: TEST_REPO_ID_2.toString(),
              repoName: 'repo2',
              previousHealth: 'active',
              currentHealth: 'quiet',
              daysSinceActivity: 10,
            },
            evidence: { repoIds: [TEST_REPO_ID_2.toString()] },
            confidence: 'High',
          },
        ],
        new Date()
      );

      const stored = await Insight.find({
        userId: TEST_USER_ID,
        range: '30d',
        templateId: 'project_health',
      }).lean();
      assert.equal(stored.length, 2, 'both per-repo project_health insights must be stored');
      const storedRepoIds = new Set(stored.map((i) => i.repoId && i.repoId.toString()));
      assert.ok(storedRepoIds.has(TEST_REPO_ID_1.toString()), 'repo 1 insight must be stored');
      assert.ok(storedRepoIds.has(TEST_REPO_ID_2.toString()), 'repo 2 insight must be stored');
    } finally {
      await mongoose.connection.db
        .collection('insights')
        .deleteMany({ userId: TEST_USER_ID })
        .catch(() => {});
    }
  });
});
