/**
 * Exponential backoff with bounded jitter.
 */

const { BACKOFF_BASE_MS, BACKOFF_MAX_MS, JITTER_MAX_MS } = require('./constants.js');

/**
 * Exponential backoff: `min(base * 2^attempt, max) + bounded jitter`.
 * Total bound: `max + jitterMax`. `rng` is injectable for deterministic tests.
 * @param {number} attempt 0-based retry attempt
 * @param {{ baseMs?: number, maxMs?: number, jitterMs?: number, rng?: () => number }} [opts]
 * @returns {number} ms to sleep
 */
function computeBackoffMs(
  attempt,
  { baseMs = BACKOFF_BASE_MS, maxMs = BACKOFF_MAX_MS, jitterMs = JITTER_MAX_MS, rng = Math.random } = {}
) {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new TypeError('attempt must be a non-negative integer');
  }
  const exponential = Math.min(baseMs * 2 ** attempt, maxMs);
  const jitter = Math.floor(rng() * jitterMs);
  return exponential + jitter;
}

module.exports = { computeBackoffMs };
