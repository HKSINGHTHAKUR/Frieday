/**
 * Rate-limit gate (architecture.md §8, tasks.md T2.1) — public API re-exports.
 *
 * This module aggregates the internal rate-limit implementation split across:
 * - constants.js   — configuration constants
 * - errors.js      — RateLimitedError class
 * - utils.js       — small helpers (toInt)
 * - headers.js     — header normalization & parsing
 * - classify.js    — 403/429 classification logic
 * - resume.js      — resume time & low-quota logic
 * - backoff.js     — exponential backoff with jitter
 * - semaphore.js   — FIFO concurrency semaphore
 * - gate.js        — main gate implementation
 *
 * All T2.1 behavior is preserved; see individual modules for docs.
 */

const constants = require('./rateLimit/constants.js');
const errors = require('./rateLimit/errors.js');
const headers = require('./rateLimit/headers.js');
const classify = require('./rateLimit/classify.js');
const resume = require('./rateLimit/resume.js');
const backoff = require('./rateLimit/backoff.js');
const semaphore = require('./rateLimit/semaphore.js');
const gate = require('./rateLimit/gate.js');

module.exports = {
  // Errors
  RateLimitedError: errors.RateLimitedError,

  // Header parsing
  parseRateLimitHeaders: headers.parseRateLimitHeaders,
  normalizeHeaders: headers.normalizeHeaders,

  // Classification
  classifyLimit: classify.classifyLimit,

  // Resume time & low-quota
  computeResumeAt: resume.computeResumeAt,
  shouldPauseForLowQuota: resume.shouldPauseForLowQuota,

  // Backoff
  computeBackoffMs: backoff.computeBackoffMs,

  // Semaphore
  createSemaphore: semaphore.createSemaphore,

  // Gate (main entry point)
  createRateLimitGate: gate.createRateLimitGate,

  // Constants (re-exported for tests and consumers)
  BACKOFF_BASE_MS: constants.BACKOFF_BASE_MS,
  BACKOFF_MAX_MS: constants.BACKOFF_MAX_MS,
  JITTER_MAX_MS: constants.JITTER_MAX_MS,
  LOW_WATERMARK: constants.LOW_WATERMARK,
  MAX_COOLDOWN_MS: constants.MAX_COOLDOWN_MS,
  MAX_RETRIES: constants.MAX_RETRIES,
  DEFAULT_CONCURRENCY: constants.DEFAULT_CONCURRENCY,
};
