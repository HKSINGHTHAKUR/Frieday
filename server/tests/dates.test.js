/**
 * Date utilities tests (T4.1)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  dayStartUTC,
  dayBucketKey,
  weekStartUTC,
  weekBucketKey,
  iterDayBuckets,
  iterWeekBuckets,
  dayKeyToDate,
  weekKeyToDate,
  detectBucketType,
} = require('../src/utils/dates');

describe('dates.js (T4.1)', () => {
  describe('dayStartUTC', () => {
    it('truncates to UTC midnight', () => {
      const d = new Date('2024-01-15T14:30:45.123Z');
      const out = dayStartUTC(d);
      assert.equal(out.getUTCHours(), 0);
      assert.equal(out.getUTCMinutes(), 0);
      assert.equal(out.getUTCSeconds(), 0);
      assert.equal(out.getUTCMilliseconds(), 0);
      assert.equal(out.getUTCFullYear(), 2024);
      assert.equal(out.getUTCMonth(), 0);
      assert.equal(out.getUTCDate(), 15);
    });

    it('does not mutate input', () => {
      const d = new Date('2024-01-15T14:30:45.123Z');
      const orig = d.getTime();
      dayStartUTC(d);
      assert.equal(d.getTime(), orig);
    });

    it('handles midnight already', () => {
      const d = new Date('2024-01-15T00:00:00.000Z');
      const out = dayStartUTC(d);
      assert.equal(out.getTime(), d.getTime());
    });
  });

  describe('dayBucketKey', () => {
    it('returns YYYY-MM-DD', () => {
      assert.equal(dayBucketKey(new Date('2024-01-15T14:30:45Z')), '2024-01-15');
      assert.equal(dayBucketKey(new Date('2024-12-31T23:59:59Z')), '2024-12-31');
      assert.equal(dayBucketKey(new Date('2024-06-05T00:00:00Z')), '2024-06-05');
    });

    it('does not mutate input', () => {
      const d = new Date('2024-01-15T14:30:45Z');
      const orig = d.getTime();
      dayBucketKey(d);
      assert.equal(d.getTime(), orig);
    });
  });

  describe('weekStartUTC', () => {
    it('returns Monday for a Monday', () => {
      // 2024-01-15 is a Monday
      const d = new Date('2024-01-15T14:30:45Z');
      const out = weekStartUTC(d);
      assert.equal(out.getUTCDay(), 1); // Monday
      assert.equal(out.getUTCDate(), 15);
    });

    it('returns previous Monday for Tuesday-Sunday', () => {
      // 2024-01-16 is Tuesday -> Monday 15th
      assert.equal(weekStartUTC(new Date('2024-01-16T14:30:45Z')).getUTCDate(), 15);
      // 2024-01-21 is Sunday -> Monday 15th
      assert.equal(weekStartUTC(new Date('2024-01-21T14:30:45Z')).getUTCDate(), 15);
      // 2024-01-22 is Monday -> 22nd
      assert.equal(weekStartUTC(new Date('2024-01-22T14:30:45Z')).getUTCDate(), 22);
    });

    it('handles year boundary: Dec 31, 2023 (Sun) -> week of Dec 25', () => {
      // 2023-12-31 is a Sunday -> week starts Monday Dec 25
      const sun = new Date('2023-12-31T14:30:45Z');
      const out = weekStartUTC(sun);
      assert.equal(out.getUTCFullYear(), 2023);
      assert.equal(out.getUTCMonth(), 11);
      assert.equal(out.getUTCDate(), 25);
    });

    it('Jan 1, 2024 (Mon) is its own week start', () => {
      const mon = new Date('2024-01-01T14:30:45Z');
      const out = weekStartUTC(mon);
      assert.equal(out.getUTCFullYear(), 2024);
      assert.equal(out.getUTCMonth(), 0);
      assert.equal(out.getUTCDate(), 1);
    });

    it('does not mutate input', () => {
      const d = new Date('2024-01-16T14:30:45Z');
      const orig = d.getTime();
      weekStartUTC(d);
      assert.equal(d.getTime(), orig);
    });
  });

  describe('weekBucketKey', () => {
    it('returns YYYY-Www format', () => {
      // 2024-01-15 (Monday) -> week 03 of 2024 (since Jan 1 is Monday, week 1)
      assert.equal(weekBucketKey(new Date('2024-01-15T14:30:45Z')), '2024-W03');
      // Same week
      assert.equal(weekBucketKey(new Date('2024-01-16T14:30:45Z')), '2024-W03');
      assert.equal(weekBucketKey(new Date('2024-01-21T14:30:45Z')), '2024-W03');
    });

    it('different week', () => {
      assert.equal(weekBucketKey(new Date('2024-01-22T14:30:45Z')), '2024-W04');
    });

    it('year boundary: Dec 31, 2023 -> 2023-W52', () => {
      // Week of Dec 25-31, 2023 is week 52 of 2023
      assert.equal(weekBucketKey(new Date('2023-12-31T14:30:45Z')), '2023-W52');
    });

    it('Jan 1, 2024 (Mon) -> 2024-W01', () => {
      assert.equal(weekBucketKey(new Date('2024-01-01T14:30:45Z')), '2024-W01');
    });
  });

  describe('iterDayBuckets', () => {
    it('generates correct sequence', () => {
      const start = new Date('2024-01-15T00:00:00Z');
      const end = new Date('2024-01-17T00:00:00Z');
      const keys = [...iterDayBuckets(start, end)];
      assert.deepEqual(keys, ['2024-01-15', '2024-01-16', '2024-01-17']);
    });

    it('single day', () => {
      const keys = [...iterDayBuckets(new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T00:00:00Z'))];
      assert.deepEqual(keys, ['2024-01-15']);
    });

    it('handles month boundary', () => {
      const keys = [...iterDayBuckets(new Date('2024-01-30T00:00:00Z'), new Date('2024-02-02T00:00:00Z'))];
      assert.deepEqual(keys, ['2024-01-30', '2024-01-31', '2024-02-01', '2024-02-02']);
    });
  });

  describe('iterWeekBuckets', () => {
    it('generates correct sequence', () => {
      const start = new Date('2024-01-15T00:00:00Z'); // Monday
      const end = new Date('2024-01-29T00:00:00Z'); // Monday
      const keys = [...iterWeekBuckets(start, end)];
      assert.deepEqual(keys, ['2024-W03', '2024-W04', '2024-W05']);
    });

    it('single week', () => {
      const keys = [...iterWeekBuckets(new Date('2024-01-15T00:00:00Z'), new Date('2024-01-21T00:00:00Z'))];
      assert.deepEqual(keys, ['2024-W03']);
    });
  });

  describe('dayKeyToDate', () => {
    it('parses valid key', () => {
      const d = dayKeyToDate('2024-01-15');
      assert.ok(d instanceof Date);
      assert.equal(d.getUTCFullYear(), 2024);
      assert.equal(d.getUTCMonth(), 0);
      assert.equal(d.getUTCDate(), 15);
      assert.equal(d.getUTCHours(), 0);
    });

    it('returns null for invalid format', () => {
      assert.equal(dayKeyToDate('2024/01/15'), null);
      assert.equal(dayKeyToDate('15-01-2024'), null);
      assert.equal(dayKeyToDate('invalid'), null);
      assert.equal(dayKeyToDate(''), null);
    });

    it('returns null for invalid date', () => {
      assert.equal(dayKeyToDate('2024-13-01'), null);
      assert.equal(dayKeyToDate('2024-02-30'), null);
    });
  });

  describe('weekKeyToDate', () => {
    it('parses valid key to Monday', () => {
      const d = weekKeyToDate('2024-W03');
      assert.ok(d instanceof Date);
      assert.equal(d.getUTCDay(), 1); // Monday
      assert.equal(d.getUTCHours(), 0);
    });

    it('returns null for invalid format', () => {
      assert.equal(weekKeyToDate('2024-03'), null);
      assert.equal(weekKeyToDate('2024-W'), null);
      assert.equal(weekKeyToDate('invalid'), null);
    });

    it('returns null for invalid week number', () => {
      assert.equal(weekKeyToDate('2024-W00'), null);
      assert.equal(weekKeyToDate('2024-W54'), null);
    });
  });

  describe('detectBucketType', () => {
    it('detects day keys', () => {
      assert.equal(detectBucketType('2024-01-15'), 'day');
    });

    it('detects week keys', () => {
      assert.equal(detectBucketType('2024-W03'), 'week');
    });

    it('returns null for unknown', () => {
      assert.equal(detectBucketType('invalid'), null);
      assert.equal(detectBucketType(''), null);
    });
  });
});
