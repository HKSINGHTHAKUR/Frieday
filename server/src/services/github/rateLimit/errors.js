/**
 * Rate-limit error class (architecture.md §5 error code: RATE_LIMITED).
 * Carries safe retry information only — never tokens or credentials.
 */

class RateLimitedError extends Error {
  /**
   * @param {{ resumeAt: Date, retryAfterMs?: number|null, kind?: string, attempts?: number }} parts
   */
  constructor({ resumeAt, retryAfterMs = null, kind = null, attempts = 0 }) {
    super('GitHub API rate limit reached. Retry after the resume time.');
    this.name = 'RateLimitedError';
    this.code = 'RATE_LIMITED';
    this.retryable = true;
    this.resumeAt = resumeAt;
    this.retryAfterMs = retryAfterMs;
    this.kind = kind;
    this.attempts = attempts;
  }
}

module.exports = { RateLimitedError };
