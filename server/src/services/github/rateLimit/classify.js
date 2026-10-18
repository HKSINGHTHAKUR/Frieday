/**
 * Rate-limit classification logic.
 * Only responses carrying limit signals are rate limits — a 403 WITHOUT
 * limit headers (permission/SSO) must propagate, not be retried.
 */

const { parseRateLimitHeaders } = require('./headers.js');

/**
 * Classify a limit response.
 * @param {{ status: number }} result
 * @returns {'primary'|'secondary'|null}
 */
function classifyLimit(result) {
  if (!result) return null;
  if (result.status === 429) return 'secondary';
  if (result.status === 403) {
    const parsed = parseRateLimitHeaders(result.headers);
    if (parsed.remaining === 0) return 'primary';
    if (parsed.retryAfterMs !== null) return 'secondary';
    return null;
  }
  return null;
}

module.exports = { classifyLimit };
