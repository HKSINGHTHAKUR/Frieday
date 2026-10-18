/**
 * Streak and gap analysis helpers (T4.2) — pure functions for streak
 * computation and gap analysis.
 *
 * Pure: no I/O, no wall-clock, no randomness, no mutation of inputs.
 */

const { dayKeyToDate, dayBucketKey } = require('../../utils/dates');

/**
 * Compute streak lengths from sorted active day keys.
 * @param {string[]} sortedActive - sorted active day keys
 * @param {Date} anchor - anchor date
 * @returns {Object} { longestStreak, currentStreak }
 */
function computeStreaks(sortedActive, anchor) {
  let longestStreak = 0;
  let tempStreak = 0;
  let prevKey = null;

  for (const key of sortedActive) {
    if (prevKey === null) {
      tempStreak = 1;
    } else {
      const prevDate = dayKeyToDate(prevKey);
      const currDate = dayKeyToDate(key);
      const diffDays = (currDate - prevDate) / (24 * 60 * 60 * 1000);
      if (diffDays === 1) {
        tempStreak += 1;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    prevKey = key;
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  // Current streak: count back from anchor day
  const anchorKey = dayBucketKey(anchor);
  let currentStreakCount = 0;
  let checkKey = anchorKey;
  const activeSet = new Set(sortedActive);

  while (activeSet.has(checkKey)) {
    currentStreakCount += 1;
    const checkDate = dayKeyToDate(checkKey);
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
    checkKey = dayBucketKey(checkDate);
  }

  return { longestStreak, currentStreakCount };
}

/**
 * Find gaps BETWEEN active days (internal gaps only, not leading/trailing).
 * @param {string[]} sortedActive - sorted active day keys
 * @returns {Array} gaps with start, end, length
 */
function findInternalGaps(sortedActive) {
  const gaps = [];
  for (let i = 1; i < sortedActive.length; i++) {
    const prevKey = sortedActive[i - 1];
    const currKey = sortedActive[i];
    const prevDate = dayKeyToDate(prevKey);
    const currDate = dayKeyToDate(currKey);
    const diffDays = (currDate - prevDate) / (24 * 60 * 60 * 1000);
    if (diffDays > 1) {
      // There's a gap between these active days
      const gapStart = dayBucketKey(new Date(prevDate.getTime() + 24 * 60 * 60 * 1000));
      const gapEnd = dayBucketKey(new Date(currDate.getTime() - 24 * 60 * 60 * 1000));
      const length = diffDays - 1;
      gaps.push({ start: gapStart, end: gapEnd, length });
    }
  }
  return gaps;
}

/**
 * Classify gaps with neutral labels.
 * @param {Array} gaps - gaps with start, end, length
 * @returns {Array} classified gaps with label and display
 */
function classifyGaps(gaps, GAP_LABELS, GAP_LABEL_DISPLAY) {
  return gaps.map((g) => {
    let label, display;
    if (g.length <= 3) {
      label = GAP_LABELS.SHORT;
      display = GAP_LABEL_DISPLAY[GAP_LABELS.SHORT];
    } else if (g.length <= 7) {
      label = GAP_LABELS.MEDIUM;
      display = GAP_LABEL_DISPLAY[GAP_LABELS.MEDIUM];
    } else if (g.length <= 30) {
      label = GAP_LABELS.LONG;
      display = GAP_LABEL_DISPLAY[GAP_LABELS.LONG];
    } else {
      label = GAP_LABELS.EXTENDED;
      display = GAP_LABEL_DISPLAY[GAP_LABELS.EXTENDED];
    }
    return {
      label,
      display,
      start: g.start,
      end: g.end,
      length: g.length,
    };
  });
}

module.exports = {
  computeStreaks,
  findInternalGaps,
  classifyGaps,
};
