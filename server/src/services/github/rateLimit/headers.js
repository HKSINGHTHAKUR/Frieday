/**
 * Header parsing utilities for GitHub rate-limit headers.
 * Malformed or missing values fail safe to null — never throw and never invent a limit.
 */

const { toInt } = require('./utils.js');

/**
 * Normalize headers to a lowercase-keyed plain object (accepts plain
 * objects — Octokit response headers — or a Headers-like with `.get`).
 * @param {object} headers
 * @returns {Record<string, string>}
 */
function normalizeHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.get === 'function') {
    const out = {};
    for (const [key, value] of headers) out[key.toLowerCase()] = value;
    return out;
  }
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) out[String(key).toLowerCase()] = String(value);
  }
  return out;
}

/**
 * Parse GitHub rate-limit headers.
 * @param {object} headers lowercase-keyed headers (e.g. Octokit `res.headers`)
 * @returns {{
 *   limit: number|null,
 *   remaining: number|null,
 *   resetAt: Date|null,
 *   retryAfterMs: number|null,
 * }} parsed values; `resetAt` from unix-seconds `x-ratelimit-reset`
 */
function parseRateLimitHeaders(headers) {
  const h = normalizeHeaders(headers);
  const limit = toInt(h['x-ratelimit-limit']);
  const remaining = toInt(h['x-ratelimit-remaining']);
  const resetSeconds = toInt(h['x-ratelimit-reset']);
  let retryAfterMs = null;
  const rawRetry = h['retry-after'];
  if (rawRetry !== undefined && rawRetry !== '') {
    const text = String(rawRetry).trim();
    if (/^\d+(\.\d+)?$/.test(text)) {
      retryAfterMs = Math.ceil(Number(text) * 1000); // seconds form
    } else if (/[A-Za-z]/.test(text)) {
      // HTTP-date form (always contains letters) — a bare signed number like
      // "-5" must not be misread as a date.
      const asDate = Date.parse(text);
      if (!Number.isNaN(asDate)) retryAfterMs = Math.max(0, asDate - Date.now());
    }
  }
  return {
    limit,
    remaining,
    resetAt: resetSeconds !== null ? new Date(resetSeconds * 1000) : null,
    retryAfterMs,
  };
}

module.exports = { normalizeHeaders, parseRateLimitHeaders };
