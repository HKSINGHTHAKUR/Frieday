/**
 * Delta calculations (T4.2) — pure functions for period-over-period percent changes.
 *
 * Formula: delta = ((current - previous) / previous) * 100
 *
 * Base suppression (PRD §18 item 5):
 *   If the previous/base value is less than 5, the percentage is suppressed
 *   to avoid misleading percentages. Returns a structured n/a result with
 *   a machine-readable reason.
 *
 * Pure: no I/O, no wall-clock, no randomness, no mutation of inputs.
 */

const DELTA_VERSION = 1;
const DELTA_SUPPRESSION_THRESHOLD = 5;
const SUPPRESSION_REASON = 'BASE_TOO_SMALL';

/**
 * Compute a single delta value.
 *
 * @param {number} current - current period value
 * @param {number} previous - previous period value
 * @returns {Object} { value, display, reason }
 *   - value: number (delta percentage) or null if suppressed
 *   - display: string (formatted percentage or 'n/a')
 *   - reason: string or null (suppression reason if applicable)
 */
function computeDelta(current, previous) {
  // Validate inputs
  if (typeof current !== 'number' || typeof previous !== 'number') {
    throw new Error('Delta inputs must be numbers');
  }
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    throw new Error('Delta inputs must be finite numbers');
  }
  if (current < 0 || previous < 0) {
    throw new Error('Delta inputs must be non-negative');
  }

  // Handle zero current
  if (current === 0 && previous === 0) {
    return {
      value: 0,
      display: '0%',
      reason: null,
    };
  }

  // Suppression: base < threshold
  if (previous < DELTA_SUPPRESSION_THRESHOLD) {
    return {
      value: null,
      display: 'n/a',
      reason: SUPPRESSION_REASON,
    };
  }

  // Normal calculation
  const delta = ((current - previous) / previous) * 100;
  const rounded = Math.round(delta * 10) / 10; // 1 decimal place

  return {
    value: rounded,
    display: `${rounded >= 0 ? '+' : ''}${rounded}%`,
    reason: null,
  };
}

/**
 * Compute deltas for multiple metrics at once.
 *
 * @param {Object} opts
 * @param {Object} opts.current - current period metrics { metricName: value }
 * @param {Object} opts.previous - previous period metrics { metricName: value }
 * @returns {Object} { deltas: { metricName: { value, display, reason } } }
 */
function computeDeltas({ current = {}, previous = {} } = {}) {
  const allKeys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  const deltas = {};

  for (const key of allKeys) {
    const curr = current[key] ?? 0;
    const prev = previous[key] ?? 0;
    deltas[key] = computeDelta(curr, prev);
  }

  return { deltas };
}

/**
 * Compute delta for a single metric with explicit values.
 *
 * @param {number} current - current value
 * @param {number} previous - previous value
 * @returns {Object} delta result
 */
function computeSingleDelta(current, previous) {
  return computeDelta(current, previous);
}

module.exports = {
  DELTA_VERSION,
  DELTA_SUPPRESSION_THRESHOLD,
  SUPPRESSION_REASON,
  computeDelta,
  computeDeltas,
  computeSingleDelta,
};
