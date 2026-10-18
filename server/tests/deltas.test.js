/**
 * Delta calculations tests (T4.2)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DELTA_VERSION,
  DELTA_SUPPRESSION_THRESHOLD,
  SUPPRESSION_REASON,
  computeDelta,
  computeDeltas,
  computeSingleDelta,
} = require('../src/services/intelligence/deltas');

describe('deltas.js (T4.2)', () => {
  describe('DELTA_VERSION', () => {
    it('is 1', () => assert.equal(DELTA_VERSION, 1));
  });

  describe('DELTA_SUPPRESSION_THRESHOLD', () => {
    it('is 5', () => assert.equal(DELTA_SUPPRESSION_THRESHOLD, 5));
  });

  describe('SUPPRESSION_REASON', () => {
    it('is BASE_TOO_SMALL', () => assert.equal(SUPPRESSION_REASON, 'BASE_TOO_SMALL'));
  });

  describe('computeDelta', () => {
    it('normal increase', () => {
      const out = computeDelta(10, 5);
      assert.equal(out.value, 100);
      assert.equal(out.display, '+100%');
      assert.equal(out.reason, null);
    });

    it('normal decrease', () => {
      const out = computeDelta(5, 10);
      assert.equal(out.value, -50);
      assert.equal(out.display, '-50%');
      assert.equal(out.reason, null);
    });

    it('unchanged', () => {
      const out = computeDelta(10, 10);
      assert.equal(out.value, 0);
      assert.equal(out.display, '+0%');
      assert.equal(out.reason, null);
    });

    it('current = 0, previous > 0', () => {
      const out = computeDelta(0, 10);
      assert.equal(out.value, -100);
      assert.equal(out.display, '-100%');
      assert.equal(out.reason, null);
    });

    it('current = 0, previous = 0', () => {
      const out = computeDelta(0, 0);
      assert.equal(out.value, 0);
      assert.equal(out.display, '0%');
      assert.equal(out.reason, null);
    });

    it('previous = 1 (suppressed)', () => {
      const out = computeDelta(10, 1);
      assert.equal(out.value, null);
      assert.equal(out.display, 'n/a');
      assert.equal(out.reason, SUPPRESSION_REASON);
    });

    it('previous = 2 (suppressed)', () => {
      const out = computeDelta(10, 2);
      assert.equal(out.value, null);
      assert.equal(out.display, 'n/a');
      assert.equal(out.reason, SUPPRESSION_REASON);
    });

    it('previous = 4 (suppressed)', () => {
      const out = computeDelta(10, 4);
      assert.equal(out.value, null);
      assert.equal(out.display, 'n/a');
      assert.equal(out.reason, SUPPRESSION_REASON);
    });

    it('previous = 5 (NOT suppressed - threshold)', () => {
      const out = computeDelta(10, 5);
      assert.equal(out.value, 100);
      assert.equal(out.display, '+100%');
      assert.equal(out.reason, null);
    });

    it('previous = 6 (NOT suppressed)', () => {
      const out = computeDelta(10, 6);
      assert.equal(out.value, 66.7);
      assert.equal(out.display, '+66.7%');
      assert.equal(out.reason, null);
    });

    it('previous > 5 (not suppressed)', () => {
      const out = computeDelta(100, 20);
      assert.equal(out.value, 400);
      assert.equal(out.display, '+400%');
      assert.equal(out.reason, null);
    });

    it('decimal precision: one decimal place', () => {
      const out = computeDelta(11, 10);
      assert.equal(out.value, 10);
      assert.equal(out.display, '+10%');

      const out2 = computeDelta(13, 10);
      assert.equal(out2.value, 30);
      assert.equal(out2.display, '+30%');
    });

    it('throws on non-number inputs', () => {
      assert.throws(() => computeDelta('10', 5), /numbers/);
      assert.throws(() => computeDelta(10, '5'), /numbers/);
      assert.throws(() => computeDelta(null, 5), /numbers/);
    });

    it('throws on non-finite inputs', () => {
      assert.throws(() => computeDelta(Infinity, 5), /finite/);
      assert.throws(() => computeDelta(10, NaN), /finite/);
    });

    it('throws on negative inputs', () => {
      assert.throws(() => computeDelta(-1, 5), /non-negative/);
      assert.throws(() => computeDelta(10, -5), /non-negative/);
    });
  });

  describe('computeSingleDelta', () => {
    it('wraps computeDelta', () => {
      const out = computeSingleDelta(10, 5);
      assert.equal(out.value, 100);
      assert.equal(out.display, '+100%');
    });
  });

  describe('computeDeltas', () => {
    it('multiple metrics', () => {
      const current = { commits: 10, prs: 5, issues: 3 };
      const previous = { commits: 5, prs: 10, issues: 3 };
      const out = computeDeltas({ current, previous });
      assert.equal(out.deltas.commits.value, 100);
      assert.equal(out.deltas.prs.value, -50);
      // issues: current=3, previous=3 -> previous=3 < 5 (threshold) -> suppressed
      assert.equal(out.deltas.issues.value, null);
      assert.equal(out.deltas.issues.reason, 'BASE_TOO_SMALL');
    });

    it('handles missing keys (treats as 0)', () => {
      const current = { commits: 10 };
      const previous = { prs: 5 };
      const out = computeDeltas({ current, previous });
      assert.equal(out.deltas.commits.value, null); // 10 vs 0 -> previous < 5 -> suppressed
      assert.equal(out.deltas.commits.reason, 'BASE_TOO_SMALL');
      // prs: current=0 (missing), previous=5 -> delta = (0-5)/5*100 = -100%, previous=5 >= 5 (threshold) -> NOT suppressed
      assert.equal(out.deltas.prs.value, -100);
      assert.equal(out.deltas.prs.display, '-100%');
    });

    it('empty objects', () => {
      const out = computeDeltas({ current: {}, previous: {} });
      assert.deepEqual(out.deltas, {});
    });

    it('handles fractional values', () => {
      const current = { metric: 10.5 };
      const previous = { metric: 5.0 };
      const out = computeDeltas({ current, previous });
      // (10.5 - 5) / 5 * 100 = 110%
      assert.equal(out.deltas.metric.value, 110);
    });
  });

  describe('determinism', () => {
    it('same input -> same output', () => {
      const out1 = computeDelta(10, 5);
      const out2 = computeDelta(10, 5);
      assert.deepEqual(out1, out2);
    });

    it('computeDeltas same input -> same output', () => {
      const current = { a: 10, b: 20 };
      const previous = { a: 5, b: 10 };
      const out1 = computeDeltas({ current, previous });
      const out2 = computeDeltas({ current, previous });
      assert.deepEqual(out1, out2);
    });

    it('input order does not affect computeDeltas', () => {
      const current1 = { a: 10, b: 20 };
      const current2 = { b: 20, a: 10 };
      const previous1 = { a: 5, b: 10 };
      const previous2 = { b: 10, a: 5 };
      const out1 = computeDeltas({ current: current1, previous: previous1 });
      const out2 = computeDeltas({ current: current2, previous: previous2 });
      assert.deepEqual(out1, out2);
    });
  });

  describe('edge cases', () => {
    it('previous = 0, current = 0 -> 0%', () => {
      const out = computeDelta(0, 0);
      assert.equal(out.value, 0);
      assert.equal(out.display, '0%');
    });

    it('previous = 0, current > 0 -> suppressed', () => {
      const out = computeDelta(10, 0);
      assert.equal(out.value, null);
      assert.equal(out.display, 'n/a');
      assert.equal(out.reason, 'BASE_TOO_SMALL');
    });

    it('large numbers', () => {
      const out = computeDelta(1000000, 100000);
      assert.equal(out.value, 900);
      assert.equal(out.display, '+900%');
    });

    it('small fractional changes', () => {
      const out = computeDelta(101, 100);
      assert.equal(out.value, 1);
      assert.equal(out.display, '+1%');
    });
  });
});
