/**
 * Date utilities (architecture.md §10) — pure UTC bucket helpers.
 *
 * All functions operate in UTC and are deterministic (no wall-clock
 * dependencies). Monday is the week start per PRD §18.
 *
 * Exported:
 * - dayStartUTC(date)     -> Date at 00:00:00.000 UTC for the given date
 * - dayBucketKey(date)    -> ISO string key for daily buckets (YYYY-MM-DD)
 * - weekStartUTC(date)    -> Date at 00:00:00.000 UTC for the Monday of the week
 * - weekBucketKey(date)   -> ISO string key for weekly buckets (YYYY-Www)
 * - iterDayBuckets(start, end)    -> generator of day bucket keys in range
 * - iterWeekBuckets(start, end)   -> generator of week bucket keys in range
 * - bucketKeyToDate(key)  -> parses day/week bucket key back to start Date
 */

/**
 * Returns a new Date at 00:00:00.000 UTC for the same calendar day.
 * Does not mutate the input.
 */
function dayStartUTC(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns an ISO day key (YYYY-MM-DD) for daily bucketing.
 * Pure function: does not mutate input.
 */
function dayBucketKey(date) {
  const d = dayStartUTC(date);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns a new Date at 00:00:00.000 UTC for the Monday of the given date's week.
 * Monday is day 1 in getUTCDay() (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
 * Does not mutate the input.
 */
function weekStartUTC(date) {
  const d = dayStartUTC(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Days to subtract to reach Monday: (day + 6) % 7
  // If day=1 (Mon), subtract 0; if day=0 (Sun), subtract 6; etc.
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/**
 * Returns an ISO week key (YYYY-Www) for weekly bucketing, Monday-based.
 * Format: YYYY-Www where ww is zero-padded ISO week number (01-53).
 * Uses ISO 8601 week definition: week 1 is the week containing the first Thursday
 * (equivalently, the week containing Jan 4). Monday is day 1.
 */
function weekBucketKey(date) {
  const d = weekStartUTC(date);
  // ISO week: week 1 contains the first Thursday (or Jan 4)
  // Since d is a Monday, we can determine the ISO week number
  // by checking which year's week 1 this Monday belongs to.
  // The ISO week year may differ from the Gregorian year.

  // Get the Thursday of this week (Monday + 3 days)
  const thu = new Date(d);
  thu.setUTCDate(thu.getUTCDate() + 3);

  // The ISO week year is the Gregorian year of that Thursday
  const isoYear = thu.getUTCFullYear();

  // Find the Monday of week 1 of that ISO year
  // Week 1 contains Jan 4, so find the Monday of the week containing Jan 4
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Days to subtract to get to Monday: (jan4Day + 6) % 7
  const diffToMon = (jan4Day + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - diffToMon);
  week1Monday.setUTCHours(0, 0, 0, 0);

  // Calculate week number
  const diffMs = d - week1Monday;
  const weekNum = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  const weekStr = String(weekNum).padStart(2, '0');

  return `${isoYear}-W${weekStr}`;
}

/**
 * Generator yielding day bucket keys from start (inclusive) to end (inclusive).
 * Both bounds are day-started (truncated to UTC midnight).
 */
function* iterDayBuckets(start, end) {
  const current = dayStartUTC(start);
  const last = dayStartUTC(end);
  while (current <= last) {
    yield dayBucketKey(current);
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

/**
 * Generator yielding week bucket keys from start (inclusive) to end (inclusive).
 * Both bounds are week-started (truncated to Monday 00:00 UTC).
 */
function* iterWeekBuckets(start, end) {
  const current = weekStartUTC(start);
  const last = weekStartUTC(end);
  while (current <= last) {
    yield weekBucketKey(current);
    current.setUTCDate(current.getUTCDate() + 7);
  }
}

/**
 * Parses a day bucket key (YYYY-MM-DD) back to a Date at 00:00 UTC.
 * Returns null if the key is malformed.
 */
function dayKeyToDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return null;
  }
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/**
 * Parses a week bucket key (YYYY-Www) back to the Monday start Date at 00:00 UTC.
 * Returns null if the key is malformed or week number invalid.
 */
function weekKeyToDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-W\d{2}$/.test(key)) {
    return null;
  }
  const [yearStr, weekStr] = key.split('-W');
  const isoYear = Number(yearStr);
  const week = Number(weekStr);
  if (!Number.isInteger(week) || week < 1 || week > 53) {
    return null;
  }
  // Find the Monday of week 1 of that ISO year
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay();
  const diffToMon = (jan4Day + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - diffToMon);
  week1Monday.setUTCHours(0, 0, 0, 0);

  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

/**
 * Determines bucket type from a key string.
 * Returns 'day' for YYYY-MM-DD, 'week' for YYYY-Www, null otherwise.
 */
function detectBucketType(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'day';
  if (/^\d{4}-W\d{2}$/.test(key)) return 'week';
  return null;
}

module.exports = {
  dayStartUTC,
  dayBucketKey,
  weekStartUTC,
  weekBucketKey,
  iterDayBuckets,
  iterWeekBuckets,
  dayKeyToDate,
  weekKeyToDate,
  detectBucketType,
};
