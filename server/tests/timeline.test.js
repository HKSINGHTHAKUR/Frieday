/**
 * Timeline aggregation tests (T4.1)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  rangeStart,
  bucketTypeForRange,
  bucketKeyFor,
  computeTimeline,
  computeRepoTimeline,
} = require('../src/services/intelligence/timeline');

const ANCHOR = new Date('2024-01-31T12:00:00Z'); // Fixed anchor for determinism

describe('timeline.js (T4.1)', () => {
  describe('rangeStart', () => {
    it('30d: 29 days before anchor (inclusive = 30 days)', () => {
      const start = rangeStart('30d', ANCHOR);
      assert.equal(start.getUTCFullYear(), 2024);
      assert.equal(start.getUTCMonth(), 0);
      assert.equal(start.getUTCDate(), 2); // 31 - 29 = 2
      assert.equal(start.getUTCHours(), 0);
    });

    it('90d: 89 days before anchor', () => {
      const start = rangeStart('90d', ANCHOR);
      // Jan 31 - 89 days = Nov 3, 2023
      assert.equal(start.getUTCFullYear(), 2023);
      assert.equal(start.getUTCMonth(), 10); // November
      assert.equal(start.getUTCDate(), 3);
    });

    it('12m: 11 months before, first of month', () => {
      const start = rangeStart('12m', ANCHOR);
      assert.equal(start.getUTCFullYear(), 2023);
      assert.equal(start.getUTCMonth(), 1); // February
      assert.equal(start.getUTCDate(), 1);
      assert.equal(start.getUTCHours(), 0);
    });

    it('throws on invalid range', () => {
      assert.throws(() => rangeStart('invalid', ANCHOR), /Invalid range/);
    });
  });

  describe('bucketTypeForRange', () => {
    it('30d -> day', () => assert.equal(bucketTypeForRange('30d'), 'day'));
    it('90d -> week', () => assert.equal(bucketTypeForRange('90d'), 'week'));
    it('12m -> week', () => assert.equal(bucketTypeForRange('12m'), 'week'));
  });

  describe('bucketKeyFor', () => {
    it('30d uses day key', () => {
      assert.equal(bucketKeyFor(new Date('2024-01-15T14:30:00Z'), '30d'), '2024-01-15');
    });
    it('90d uses week key', () => {
      assert.equal(bucketKeyFor(new Date('2024-01-15T14:30:00Z'), '90d'), '2024-W03');
    });
  });

  describe('computeTimeline - 30d (daily buckets)', () => {
    it('empty input returns all zero buckets', () => {
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR });
      assert.equal(buckets.length, 30);
      for (const b of buckets) {
        assert.equal(b.commits, 0);
        assert.equal(b.prsOpened, 0);
        assert.equal(b.prsMerged, 0);
        assert.equal(b.issuesTouched, 0);
      }
    });

    it('single commit on anchor day', () => {
      const commits = [{ authoredAt: new Date('2024-01-31T10:00:00Z'), repoId: 'repo1' }];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, commits });
      const last = buckets[buckets.length - 1];
      assert.equal(last.bucketStart.toISOString().slice(0, 10), '2024-01-31');
      assert.equal(last.commits, 1);
    });

    it('commit exactly at 00:00 UTC counted in that day', () => {
      const commits = [{ authoredAt: new Date('2024-01-15T00:00:00.000Z'), repoId: 'repo1' }];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, commits });
      // Find the bucket for 2024-01-15
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-15');
      assert.ok(b);
      assert.equal(b.commits, 1);
    });

    it('commit outside range ignored', () => {
      const commits = [{ authoredAt: new Date('2023-12-01T10:00:00Z'), repoId: 'repo1' }];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, commits });
      const total = buckets.reduce((a, b) => a + b.commits, 0);
      assert.equal(total, 0);
    });

    it('multiple commits same day aggregate', () => {
      const commits = [
        { authoredAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-20T14:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-20T22:00:00Z'), repoId: 'repo2' },
      ];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, commits });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.commits, 3);
    });

    it('PR opened counted by createdAt', () => {
      const prs = [{ createdAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' }];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, pullRequests: prs });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.prsOpened, 1);
    });

    it('PR merged counted by mergedAt', () => {
      const prs = [{ mergedAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' }];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, pullRequests: prs });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.prsMerged, 1);
    });

    it('PR both opened and merged in different buckets', () => {
      const prs = [
        {
          createdAt: new Date('2024-01-10T10:00:00Z'),
          mergedAt: new Date('2024-01-20T10:00:00Z'),
          repoId: 'repo1',
        },
      ];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, pullRequests: prs });
      const b1 = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-10');
      const b2 = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b1.prsOpened, 1);
      assert.equal(b1.prsMerged, 0);
      assert.equal(b2.prsOpened, 0);
      assert.equal(b2.prsMerged, 1);
    });

    it('issue touched by createdAt', () => {
      const issues = [{ createdAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1', number: 1 }];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, issues });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.issuesTouched, 1);
    });

    it('issue touched by updatedAt (different from createdAt)', () => {
      const issues = [
        {
          createdAt: new Date('2024-01-10T10:00:00Z'),
          updatedAt: new Date('2024-01-20T10:00:00Z'),
          repoId: 'repo1',
          number: 1,
        },
      ];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, issues });
      const b1 = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-10');
      const b2 = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b1.issuesTouched, 1);
      assert.equal(b2.issuesTouched, 1);
    });

    it('same issue created and updated in same bucket counted once', () => {
      const issues = [
        {
          createdAt: new Date('2024-01-20T08:00:00Z'),
          updatedAt: new Date('2024-01-20T10:00:00Z'),
          repoId: 'repo1',
          number: 1,
        },
      ];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, issues });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.issuesTouched, 1);
    });

    it('multiple repos aggregated', () => {
      const commits = [
        { authoredAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-20T14:00:00Z'), repoId: 'repo2' },
      ];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, commits });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.commits, 2);
    });

    it('repoFilter limits to one repo', () => {
      const commits = [
        { authoredAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-20T14:00:00Z'), repoId: 'repo2' },
      ];
      const buckets = computeTimeline({
        range: '30d',
        anchor: ANCHOR,
        commits,
        repoFilter: { repoId: 'repo1' },
      });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.commits, 1);
    });

    it('buckets sorted by bucketStart ascending', () => {
      const commits = [
        { authoredAt: new Date('2024-01-25T10:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' },
      ];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, commits });
      const dates = buckets.map((b) => b.bucketStart.getTime());
      for (let i = 1; i < dates.length; i++) {
        assert.ok(dates[i] >= dates[i - 1], 'buckets must be sorted ascending');
      }
    });
  });

  describe('computeTimeline - 90d (weekly buckets)', () => {
    it('returns weekly buckets', () => {
      const buckets = computeTimeline({ range: '90d', anchor: ANCHOR });
      // 90 days = ~13 weeks
      assert.ok(buckets.length >= 12 && buckets.length <= 14);
    });

    it('commit on Tuesday counted in Monday bucket', () => {
      // 2024-01-16 is Tuesday, Monday is 2024-01-15
      const commits = [{ authoredAt: new Date('2024-01-16T10:00:00Z'), repoId: 'repo1' }];
      const buckets = computeTimeline({ range: '90d', anchor: ANCHOR, commits });
      const b = buckets.find((b) => b.bucketStart.getTime() === new Date('2024-01-15T00:00:00Z').getTime());
      assert.ok(b);
      assert.equal(b.commits, 1);
    });

    it('commit on Sunday counted in previous Monday bucket', () => {
      // 2024-01-21 is Sunday, Monday is 2024-01-15
      const commits = [{ authoredAt: new Date('2024-01-21T10:00:00Z'), repoId: 'repo1' }];
      const buckets = computeTimeline({ range: '90d', anchor: ANCHOR, commits });
      const b = buckets.find((b) => b.bucketStart.getTime() === new Date('2024-01-15T00:00:00Z').getTime());
      assert.ok(b);
      assert.equal(b.commits, 1);
    });

    it('PR opened and merged in different weeks', () => {
      const prs = [
        {
          createdAt: new Date('2024-01-10T10:00:00Z'),
          mergedAt: new Date('2024-01-24T10:00:00Z'),
          repoId: 'repo1',
        },
      ];
      const buckets = computeTimeline({ range: '90d', anchor: ANCHOR, pullRequests: prs });
      // Jan 10 -> week of Jan 8 (Monday)
      // Jan 24 -> week of Jan 22 (Monday)
      const b1 = buckets.find((b) => b.bucketStart.getTime() === new Date('2024-01-08T00:00:00Z').getTime());
      const b2 = buckets.find((b) => b.bucketStart.getTime() === new Date('2024-01-22T00:00:00Z').getTime());
      assert.equal(b1.prsOpened, 1);
      assert.equal(b2.prsMerged, 1);
    });
  });

  describe('computeTimeline - 12m (weekly buckets)', () => {
    it('returns weekly buckets for ~12 months', () => {
      const buckets = computeTimeline({ range: '12m', anchor: ANCHOR });
      // ~52 weeks
      assert.ok(buckets.length >= 50 && buckets.length <= 54);
    });

    it('starts at Monday of week containing range start', () => {
      const buckets = computeTimeline({ range: '12m', anchor: ANCHOR });
      const first = buckets[0];
      // Range start is Feb 1, 2023 (Wed) -> week starts Mon Jan 30
      assert.equal(first.bucketStart.getUTCFullYear(), 2023);
      assert.equal(first.bucketStart.getUTCMonth(), 0); // January
      assert.equal(first.bucketStart.getUTCDate(), 30);
      assert.equal(first.bucketStart.getUTCDay(), 1); // Monday
    });
  });

  describe('computeRepoTimeline', () => {
    it('filters by repoId', () => {
      const commits = [
        { authoredAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-20T14:00:00Z'), repoId: 'repo2' },
      ];
      const buckets = computeRepoTimeline({ range: '30d', anchor: ANCHOR, commits, repoId: 'repo1' });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.commits, 1);
    });
  });

  describe('computeTimeline - explicit granularity (prd.md §9 F4 semantics)', () => {
    it('30d day: one daily bucket per day (30 buckets, day starts at 00:00 UTC)', () => {
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, granularity: 'day' });
      assert.equal(buckets.length, 30);
      for (let i = 1; i < buckets.length; i++) {
        const diff = buckets[i].bucketStart - buckets[i - 1].bucketStart;
        assert.equal(diff, 24 * 60 * 60 * 1000, 'daily buckets are 24h apart');
      }
      assert.equal(buckets[0].bucketStart.getUTCHours(), 0);
    });

    it('30d week: weekly Monday-start buckets, ~5 buckets, no daily buckets', () => {
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, granularity: 'week' });
      assert.ok(buckets.length >= 4 && buckets.length <= 6, 'a 30d window spans ~4-5 ISO weeks');
      for (const b of buckets) {
        assert.equal(b.bucketStart.getUTCDay(), 1, 'week buckets must start on Monday');
        assert.equal(b.bucketStart.getUTCHours(), 0);
      }
    });

    it('90d day: daily buckets when explicitly requested (90 buckets)', () => {
      const buckets = computeTimeline({ range: '90d', anchor: ANCHOR, granularity: 'day' });
      assert.ok(buckets.length >= 88 && buckets.length <= 91, '90d day span');
      const diff = buckets[1].bucketStart - buckets[0].bucketStart;
      assert.equal(diff, 24 * 60 * 60 * 1000);
    });

    it('90d week (default): weekly Monday buckets, ~13 buckets, no daily buckets', () => {
      const buckets = computeTimeline({ range: '90d', anchor: ANCHOR });
      assert.ok(buckets.length >= 12 && buckets.length <= 14, '90d week span ~13');
      for (const b of buckets) {
        assert.equal(b.bucketStart.getUTCDay(), 1, 'week buckets must start on Monday');
      }
    });

    it('12m day: daily buckets when explicitly requested (~365 buckets)', () => {
      const buckets = computeTimeline({ range: '12m', anchor: ANCHOR, granularity: 'day' });
      assert.ok(buckets.length >= 360 && buckets.length <= 371, '12m day span');
      const diff = buckets[1].bucketStart - buckets[0].bucketStart;
      assert.equal(diff, 24 * 60 * 60 * 1000);
    });

    it('12m week (default): weekly Monday buckets, ~52-53 buckets', () => {
      const buckets = computeTimeline({ range: '12m', anchor: ANCHOR });
      assert.ok(buckets.length >= 50 && buckets.length <= 54, '12m week span ~52-53');
      for (const b of buckets) {
        assert.equal(b.bucketStart.getUTCDay(), 1, 'week buckets must start on Monday');
      }
    });

    it('groups a commit by its bucket only for the requested granularity (no mixing)', () => {
      const commits = [{ authoredAt: new Date('2024-01-16T10:00:00Z'), repoId: 'repo1' }];
      const day = computeTimeline({ range: '90d', anchor: ANCHOR, granularity: 'day', commits });
      const week = computeTimeline({ range: '90d', anchor: ANCHOR, granularity: 'week', commits });
      const dayTotal = day.reduce((a, b) => a + b.commits, 0);
      const weekTotal = week.reduce((a, b) => a + b.commits, 0);
      assert.equal(dayTotal, 1);
      assert.equal(weekTotal, 1);
      // The commit lands in the Tuesday daily bucket and the Monday weekly bucket
      const dayBucket = day.find((b) => b.commits > 0);
      const weekBucket = week.find((b) => b.commits > 0);
      assert.equal(dayBucket.bucketStart.toISOString().slice(0, 10), '2024-01-16');
      assert.equal(weekBucket.bucketStart.toISOString().slice(0, 10), '2024-01-15');
    });
  });

  describe('computeTimeline - 90d/12m repo-filtered (same semantics as aggregate)', () => {
    const commits = [
      { authoredAt: new Date('2024-01-16T10:00:00Z'), repoId: 'repo1' },
      { authoredAt: new Date('2024-01-17T10:00:00Z'), repoId: 'repo2' },
    ];

    it('90d week repo-filtered: only the owned repo is counted, weekly Mondays', () => {
      const agg = computeTimeline({ range: '90d', anchor: ANCHOR, commits });
      const repo = computeRepoTimeline({ range: '90d', anchor: ANCHOR, commits, repoId: 'repo1' });
      assert.equal(
        agg.reduce((a, b) => a + b.commits, 0),
        2
      );
      assert.equal(
        repo.reduce((a, b) => a + b.commits, 0),
        1
      );
      assert.equal(repo[0].bucketStart.getUTCDay(), 1);
    });

    it('12m week repo-filtered: only the owned repo is counted, weekly Mondays', () => {
      const repo = computeRepoTimeline({ range: '12m', anchor: ANCHOR, commits, repoId: 'repo2' });
      assert.equal(
        repo.reduce((a, b) => a + b.commits, 0),
        1
      );
      assert.ok(repo.length >= 50 && repo.length <= 54);
      assert.equal(repo.find((b) => b.commits > 0).bucketStart.getUTCDay(), 1);
    });

    it('90d day repo-filtered: explicit day granularity honored for repo view', () => {
      const repo = computeRepoTimeline({ range: '90d', anchor: ANCHOR, commits, repoId: 'repo1' });
      const day = computeTimeline({
        range: '90d',
        anchor: ANCHOR,
        commits,
        granularity: 'day',
        repoFilter: { repoId: 'repo1' },
      });
      assert.equal(repo[0].bucketStart.getUTCHours(), 0);
      assert.equal(
        day.reduce((a, b) => a + b.commits, 0),
        1
      );
      assert.equal(
        day
          .find((b) => b.commits > 0)
          .bucketStart.toISOString()
          .slice(0, 10),
        '2024-01-16'
      );
    });
  });

  describe('edge cases', () => {
    it('commits without authoredAt ignored', () => {
      const commits = [
        { repoId: 'repo1' },
        { authoredAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' },
      ];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, commits });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.commits, 1);
    });

    it('PR without mergedAt does not count as merged', () => {
      const prs = [{ createdAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1' }];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, pullRequests: prs });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.prsOpened, 1);
      assert.equal(b.prsMerged, 0);
    });

    it('issue without createdAt but with updatedAt counted by updatedAt', () => {
      const issues = [{ updatedAt: new Date('2024-01-20T10:00:00Z'), repoId: 'repo1', number: 1 }];
      const buckets = computeTimeline({ range: '30d', anchor: ANCHOR, issues });
      const b = buckets.find((b) => b.bucketStart.toISOString().slice(0, 10) === '2024-01-20');
      assert.equal(b.issuesTouched, 1);
    });

    it('throws on invalid range', () => {
      assert.throws(() => computeTimeline({ range: 'invalid', anchor: ANCHOR }), /Invalid range/);
    });

    it('empty arrays handled', () => {
      const buckets = computeTimeline({
        range: '30d',
        anchor: ANCHOR,
        commits: [],
        pullRequests: [],
        issues: [],
      });
      assert.equal(buckets.length, 30);
    });
  });
});
