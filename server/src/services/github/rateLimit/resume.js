/**
 * Resume time calculation and low-quota pre-emptive pause logic.
 */

const { BACKOFF_BASE_MS } = require('./constants.js');

/**
 * Effective resume time = the LATER restriction: the primary reset (if in
 * the future) vs now + Retry-After. Falls back to a conservative base wait
 * when no usable header exists. Never returns a time in the past.
 * @param {{ resetAt: Date|null, retryAfterMs: number|null }} parsed
 * @param {number} [nowMs]
 * @returns {number} epoch ms
 */
function computeResumeAt(parsed, nowMs = Date.now()) {
  const candidates = [];
  if (parsed.resetAt instanceof Date && parsed.resetAt.getTime() > nowMs) {
    candidates.push(parsed.resetAt.getTime());
  }
  if (parsed.retryAfterMs !== null && parsed.retryAfterMs >= 0) {
    candidates.push(nowMs + parsed.retryAfterMs);
  }
  if (candidates.length === 0) return nowMs + BACKOFF_BASE_MS;
  return Math.max(...candidates);
}

/**
 * Pre-emptive pause check: primary quota below the 10% watermark.
 * Fails safe (no pause) when limit/remaining are unknown.
 * @param {{ limit: number|null, remaining: number|null }} parsed
 * @returns {boolean}
 */
function shouldPauseForLowQuota(parsed, { LOW_WATERMARK = 0.1 } = {}) {
  return (
    parsed.limit !== null &&
    parsed.limit > 0 &&
    parsed.remaining !== null &&
    parsed.remaining >= 0 &&
    parsed.remaining < LOW_WATERMARK * parsed.limit
  );
}

module.exports = { computeResumeAt, shouldPauseForLowQuota };
