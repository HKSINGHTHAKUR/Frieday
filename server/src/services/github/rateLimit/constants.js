/**
 * Rate-limit gate constants (architecture.md §8, tasks.md T2.1).
 */

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const JITTER_MAX_MS = 500;
const LOW_WATERMARK = 0.1; // prd.md §17: pause when remaining < 10% of limit
const MAX_COOLDOWN_MS = 15 * 60 * 1000; // horizon matches the T2.3 sync timeout
const MAX_RETRIES = 10;
const DEFAULT_CONCURRENCY = 2; // architecture.md §8 default

module.exports = {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  JITTER_MAX_MS,
  LOW_WATERMARK,
  MAX_COOLDOWN_MS,
  MAX_RETRIES,
  DEFAULT_CONCURRENCY,
};
