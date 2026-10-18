/**
 * Consistency calculations tests (T4.2)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIVE_DAY_VERSION,
  GAP_LABELS,
  GAP_LABEL_DISPLAY,
  rangeStart,
  collectActiveDayKeys,
  analyzeStreaksAndGaps,
  computeConsistency,
  computeRepoConsistency,
} = require('../src/services/intelligence/consistency');

const ANCHOR = new Date('2024-01-31T12:00:00Z'); // Fixed anchor for determinism (Wednesday)

describe('consistency.js (T4.2)', () => {
  describe('ACTIVE_DAY_VERSION', () => {
    it('is 1', () => assert.equal(ACTIVE_DAY_VERSION, 1));
  });

  describe('GAP_LABELS', () => {
    it('has expected labels', () => {
      assert.equal(GAP_LABELS.SHORT, 'gap_short');
      assert.equal(GAP_LABELS.MEDIUM, 'gap_medium');
      assert.equal(GAP_LABELS.LONG, 'gap_long');
      assert.equal(GAP_LABELS.EXTENDED, 'gap_extended');
    });
  });

  describe('GAP_LABEL_DISPLAY', () => {
    it('has neutral display strings', () => {
      assert.equal(GAP_LABEL_DISPLAY.gap_short, 'Short gap');
      assert.equal(GAP_LABEL_DISPLAY.gap_medium, 'Medium gap');
      assert.equal(GAP_LABEL_DISPLAY.gap_long, 'Long gap');
      assert.equal(GAP_LABEL_DISPLAY.gap_extended, 'Extended gap');
    });
  });

  describe('rangeStart', () => {
    it('30d: 29 days before anchor', () => {
      const start = rangeStart('30d', ANCHOR);
      assert.equal(start.getUTCFullYear(), 2024);
      assert.equal(start.getUTCMonth(), 0);
      assert.equal(start.getUTCDate(), 2); // Jan 31 - 29 = Jan 2
    });

    it('90d: 89 days before anchor', () => {
      const start = rangeStart('90d', ANCHOR);
      assert.equal(start.getUTCFullYear(), 2023);
      assert.equal(start.getUTCMonth(), 10); // November
      assert.equal(start.getUTCDate(), 3);
    });

    it('12m: 11 months before, first of month', () => {
      const start = rangeStart('12m', ANCHOR);
      assert.equal(start.getUTCFullYear(), 2023);
      assert.equal(start.getUTCMonth(), 1); // February
      assert.equal(start.getUTCDate(), 1);
    });

    it('throws on invalid range', () => {
      assert.throws(() => rangeStart('invalid', ANCHOR), /Invalid range/);
    });
  });

  describe('collectActiveDayKeys', () => {
    it('empty input returns empty set', () => {
      const keys = collectActiveDayKeys({ range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 0);
    });

    it('commit adds active day', () => {
      const commits = [{ authoredAt: new Date('2024-01-15T10:00:00Z') }];
      const keys = collectActiveDayKeys({ commits, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 1);
      assert.ok(keys.has('2024-01-15'));
    });

    it('merged PR adds active day', () => {
      const prs = [{ mergedAt: new Date('2024-01-15T10:00:00Z') }];
      const keys = collectActiveDayKeys({ pullRequests: prs, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 1);
      assert.ok(keys.has('2024-01-15'));
    });

    it('opened PR does NOT add active day (only merged)', () => {
      const prs = [{ createdAt: new Date('2024-01-15T10:00:00Z') }];
      const keys = collectActiveDayKeys({ pullRequests: prs, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 0);
    });

    it('issue created adds active day', () => {
      const issues = [{ createdAt: new Date('2024-01-15T10:00:00Z') }];
      const keys = collectActiveDayKeys({ issues, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 1);
      assert.ok(keys.has('2024-01-15'));
    });

    it('issue closed adds active day', () => {
      const issues = [{ closedAt: new Date('2024-01-15T10:00:00Z') }];
      const keys = collectActiveDayKeys({ issues, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 1);
      assert.ok(keys.has('2024-01-15'));
    });

    it('issue updated does NOT add active day', () => {
      const issues = [{ updatedAt: new Date('2024-01-15T10:00:00Z') }];
      const keys = collectActiveDayKeys({ issues, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 0);
    });

    it('multiple events same day = one active day', () => {
      const commits = [{ authoredAt: new Date('2024-01-15T10:00:00Z') }];
      const prs = [{ mergedAt: new Date('2024-01-15T14:00:00Z') }];
      const issues = [{ createdAt: new Date('2024-01-15T16:00:00Z') }];
      const keys = collectActiveDayKeys({ commits, pullRequests: prs, issues, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 1);
      assert.ok(keys.has('2024-01-15'));
    });

    it('events outside range ignored', () => {
      const commits = [{ authoredAt: new Date('2023-12-01T10:00:00Z') }];
      const keys = collectActiveDayKeys({ commits, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 0);
    });

    it('multiple events different days', () => {
      const commits = [
        { authoredAt: new Date('2024-01-10T10:00:00Z') },
        { authoredAt: new Date('2024-01-15T10:00:00Z') },
      ];
      const keys = collectActiveDayKeys({ commits, range: '30d', anchor: ANCHOR });
      assert.equal(keys.size, 2);
    });

    it('90d range uses same day key logic', () => {
      const commits = [{ authoredAt: new Date('2023-11-15T10:00:00Z') }];
      const keys = collectActiveDayKeys({ commits, range: '90d', anchor: ANCHOR });
      assert.equal(keys.size, 1);
      assert.ok(keys.has('2023-11-15'));
    });

    it('repoFilter limits to one repo', () => {
      const commits = [
        { authoredAt: new Date('2024-01-15T10:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-15T14:00:00Z'), repoId: 'repo2' },
      ];
      const keys = collectActiveDayKeys({
        commits,
        range: '30d',
        anchor: ANCHOR,
        repoFilter: { repoId: 'repo1' },
      });
      assert.equal(keys.size, 1);
    });
  });

  describe('analyzeStreaksAndGaps', () => {
    it('empty active keys returns zero stats and one extended gap', () => {
      const analysis = analyzeStreaksAndGaps(new Set(), '30d', ANCHOR);
      assert.equal(analysis.activeDays, 0);
      assert.equal(analysis.currentStreak, 0);
      assert.equal(analysis.longestStreak, 0);
      assert.equal(analysis.gaps.length, 1);
      assert.equal(analysis.gaps[0].label, GAP_LABELS.EXTENDED);
    });

    it('single active day', () => {
      const keys = new Set(['2024-01-15']);
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      assert.equal(analysis.activeDays, 1);
      assert.equal(analysis.currentStreak, 0); // anchor day (Jan 31) is not active
      assert.equal(analysis.longestStreak, 1);
    });

    it('consecutive days form streak', () => {
      const keys = new Set(['2024-01-13', '2024-01-14', '2024-01-15']);
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      assert.equal(analysis.activeDays, 3);
      assert.equal(analysis.longestStreak, 3);
    });

    it('broken streak', () => {
      const keys = new Set(['2024-01-13', '2024-01-14', '2024-01-16']);
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      assert.equal(analysis.activeDays, 3);
      assert.equal(analysis.longestStreak, 2); // 13-14 is 2, then 16 is 1
    });

    it('current streak from anchor', () => {
      // Anchor is Jan 31 (Wednesday)
      const keys = new Set(['2024-01-29', '2024-01-30', '2024-01-31']);
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      assert.equal(analysis.currentStreak, 3);
    });

    it('current streak broken by gap', () => {
      // Anchor is Jan 31, active on 29 and 31 (gap on 30)
      const keys = new Set(['2024-01-29', '2024-01-31']);
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      assert.equal(analysis.currentStreak, 1); // Only Jan 31 counts (gap on 30 breaks)
    });

    it('longest streak across multiple streaks', () => {
      const keys = new Set([
        '2024-01-10',
        '2024-01-11',
        '2024-01-12', // streak of 3
        '2024-01-20',
        '2024-01-21', // streak of 2
        '2024-01-28',
        '2024-01-29',
        '2024-01-30',
        '2024-01-31', // streak of 4 (current)
      ]);
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      assert.equal(analysis.longestStreak, 4);
      assert.equal(analysis.currentStreak, 4);
    });

    it('gap detection: short gap (1-3 days)', () => {
      const keys = new Set(['2024-01-10', '2024-01-14']); // gap 11,12,13 = 3 days
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      const gap = analysis.gaps[0];
      assert.equal(gap.label, GAP_LABELS.SHORT);
      assert.equal(gap.length, 3);
    });

    it('gap detection: medium gap (4-7 days)', () => {
      const keys = new Set(['2024-01-10', '2024-01-16']); // gap 11,12,13,14,15 = 5 days
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      const gap = analysis.gaps[0];
      assert.equal(gap.label, GAP_LABELS.MEDIUM);
      assert.equal(gap.length, 5);
    });

    it('gap detection: long gap (8-30 days)', () => {
      const keys = new Set(['2024-01-02', '2024-01-15']); // gap 3-14 = 12 days
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      const gap = analysis.gaps[0];
      assert.equal(gap.label, GAP_LABELS.LONG);
      assert.equal(gap.length, 12);
    });

    it('gap detection: extended gap (31+ days)', () => {
      const keys = new Set(['2024-01-01', '2024-02-05']); // gap 32+ days
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      const gap = analysis.gaps[0];
      assert.equal(gap.label, GAP_LABELS.EXTENDED);
      assert.ok(gap.length >= 31);
    });

    it('multiple gaps', () => {
      const keys = new Set([
        '2024-01-10',
        '2024-01-11',
        '2024-01-15',
        '2024-01-16',
        '2024-01-25',
        '2024-01-26',
      ]);
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      assert.equal(analysis.gaps.length, 2);
    });

    it('no trailing gap when activity ends before range end', () => {
      const keys = new Set(['2024-01-10', '2024-01-11']);
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      // No trailing gap when activity ends before range end (no internal gap)
      const trailingGap = analysis.gaps.find((g) => g.end === '2024-01-31');
      assert.ok(!trailingGap, 'should not have trailing gap when no internal gap exists');
    });

    it('no leading gap if range starts with active day', () => {
      const keys = new Set(['2024-01-02', '2024-01-03']); // range starts Jan 2
      const analysis = analyzeStreaksAndGaps(keys, '30d', ANCHOR);
      // Should not have a gap before Jan 2
      const leadingGap = analysis.gaps.find((g) => g.start === '2024-01-02');
      assert.ok(!leadingGap);
    });
  });

  describe('computeConsistency', () => {
    it('empty input', () => {
      const out = computeConsistency({ range: '30d', anchor: ANCHOR });
      assert.equal(out.version, ACTIVE_DAY_VERSION);
      assert.equal(out.activeDays, 0);
      assert.equal(out.currentStreak, 0);
      assert.equal(out.longestStreak, 0);
    });

    it('commit-only active day', () => {
      const commits = [{ authoredAt: new Date('2024-01-15T10:00:00Z') }];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, commits });
      assert.equal(out.activeDays, 1);
    });

    it('merged-PR-only active day', () => {
      const prs = [{ mergedAt: new Date('2024-01-15T10:00:00Z') }];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, pullRequests: prs });
      assert.equal(out.activeDays, 1);
    });

    it('opened-PR does NOT count', () => {
      const prs = [{ createdAt: new Date('2024-01-15T10:00:00Z') }];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, pullRequests: prs });
      assert.equal(out.activeDays, 0);
    });

    it('issue-created active day', () => {
      const issues = [{ createdAt: new Date('2024-01-15T10:00:00Z') }];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, issues });
      assert.equal(out.activeDays, 1);
    });

    it('issue-closed active day', () => {
      const issues = [{ closedAt: new Date('2024-01-15T10:00:00Z') }];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, issues });
      assert.equal(out.activeDays, 1);
    });

    it('issue-updated does NOT count', () => {
      const issues = [{ updatedAt: new Date('2024-01-15T10:00:00Z') }];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, issues });
      assert.equal(out.activeDays, 0);
    });

    it('multiple event types same day = one active day', () => {
      const commits = [{ authoredAt: new Date('2024-01-15T10:00:00Z') }];
      const prs = [{ mergedAt: new Date('2024-01-15T14:00:00Z') }];
      const issues = [{ createdAt: new Date('2024-01-15T16:00:00Z') }];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, commits, pullRequests: prs, issues });
      assert.equal(out.activeDays, 1);
    });

    it('consecutive days streak', () => {
      const commits = [
        { authoredAt: new Date('2024-01-29T10:00:00Z') },
        { authoredAt: new Date('2024-01-30T10:00:00Z') },
        { authoredAt: new Date('2024-01-31T10:00:00Z') },
      ];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, commits });
      assert.equal(out.currentStreak, 3);
      assert.equal(out.longestStreak, 3);
    });

    it('broken streak', () => {
      const commits = [
        { authoredAt: new Date('2024-01-29T10:00:00Z') },
        { authoredAt: new Date('2024-01-31T10:00:00Z') },
      ];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, commits });
      assert.equal(out.currentStreak, 1); // only Jan 31
      assert.equal(out.longestStreak, 1);
    });

    it('gaps in output', () => {
      const commits = [
        { authoredAt: new Date('2024-01-10T10:00:00Z') },
        { authoredAt: new Date('2024-01-15T10:00:00Z') },
      ];
      const out = computeConsistency({ range: '30d', anchor: ANCHOR, commits });
      assert.equal(out.gaps.length, 1);
      assert.ok(out.gaps[0].label);
      assert.ok(out.gaps[0].display);
      assert.ok(out.gaps[0].length);
    });

    it('throws on invalid range', () => {
      assert.throws(() => computeConsistency({ range: 'invalid', anchor: ANCHOR }), /Invalid range/);
    });

    it('repoFilter limits to one repo', () => {
      const commits = [
        { authoredAt: new Date('2024-01-15T10:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-15T14:00:00Z'), repoId: 'repo2' },
      ];
      const out = computeConsistency({
        range: '30d',
        anchor: ANCHOR,
        commits,
        repoFilter: { repoId: 'repo1' },
      });
      assert.equal(out.activeDays, 1);
    });

    it('deterministic: same input -> same output', () => {
      const commits = [{ authoredAt: new Date('2024-01-15T10:00:00Z') }];
      const out1 = computeConsistency({ range: '30d', anchor: ANCHOR, commits });
      const out2 = computeConsistency({ range: '30d', anchor: ANCHOR, commits });
      assert.deepEqual(out1, out2);
    });

    it('input order does not affect output', () => {
      const commits1 = [
        { authoredAt: new Date('2024-01-15T10:00:00Z') },
        { authoredAt: new Date('2024-01-10T10:00:00Z') },
      ];
      const commits2 = [
        { authoredAt: new Date('2024-01-10T10:00:00Z') },
        { authoredAt: new Date('2024-01-15T10:00:00Z') },
      ];
      const out1 = computeConsistency({ range: '30d', anchor: ANCHOR, commits: commits1 });
      const out2 = computeConsistency({ range: '30d', anchor: ANCHOR, commits: commits2 });
      assert.deepEqual(out1, out2);
    });

    it('90d range weekly boundary handling', () => {
      // Test that Sunday-Monday boundary works
      const commits = [
        { authoredAt: new Date('2024-01-21T10:00:00Z') }, // Sunday
        { authoredAt: new Date('2024-01-22T10:00:00Z') }, // Monday
      ];
      const out = computeConsistency({ range: '90d', anchor: ANCHOR, commits });
      assert.equal(out.activeDays, 2);
    });
  });

  describe('computeRepoConsistency', () => {
    it('filters by repoId', () => {
      const commits = [
        { authoredAt: new Date('2024-01-15T10:00:00Z'), repoId: 'repo1' },
        { authoredAt: new Date('2024-01-15T14:00:00Z'), repoId: 'repo2' },
      ];
      const out = computeRepoConsistency({ range: '30d', anchor: ANCHOR, commits, repoId: 'repo1' });
      assert.equal(out.activeDays, 1);
    });
  });
});
