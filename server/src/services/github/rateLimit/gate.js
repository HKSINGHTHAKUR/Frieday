/**
 * Rate-limit gate — the main public API.
 * Every logical GitHub request runs through `run(attempt)`:
 * acquire a permit → honor the in-memory cooldown → attempt → on 403/429
 * limit, extend the cooldown and retry; on low primary quota, schedule a
 * pre-emptive cooldown for subsequent requests.
 */

const { createSemaphore } = require('./semaphore.js');
const { classifyLimit } = require('./classify.js');
const { parseRateLimitHeaders } = require('./headers.js');
const { computeResumeAt } = require('./resume.js');
const { shouldPauseForLowQuota } = require('./resume.js');
const { RateLimitedError } = require('./errors.js');
const { BACKOFF_BASE_MS, MAX_COOLDOWN_MS, MAX_RETRIES, DEFAULT_CONCURRENCY } = require('./constants.js');

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a rate-limit gate.
 * @param {{
 *   concurrency?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   maxCooldownMs?: number,
 *   maxRetries?: number,
 * }} [opts]
 * @returns {{
 *   run: (attempt: () => Promise<{ status: number, headers?: object, data?: any, error?: unknown }>) => Promise<any>,
 *   getStatus: (nowMs?: number) => { status: 'OK'|'RATE_LIMITED', resumeAt: Date|null, concurrency: number },
 *   concurrency: number,
 *   semaphore: object,
 * }}
 */
function createRateLimitGate({
  concurrency = DEFAULT_CONCURRENCY,
  now = () => Date.now(),
  sleep = defaultSleep,
  maxCooldownMs = MAX_COOLDOWN_MS,
  maxRetries = MAX_RETRIES,
} = {}) {
  const semaphore = createSemaphore(concurrency);
  let cooldownUntilMs = 0;

  function getStatus(nowMs = now()) {
    const limited = cooldownUntilMs > nowMs;
    return {
      status: limited ? 'RATE_LIMITED' : 'OK',
      resumeAt: limited ? new Date(cooldownUntilMs) : null,
      concurrency,
    };
  }

  /**
   * @param {() => Promise<{ status: number, headers?: object, data?: any, error?: unknown }>} attempt
   *   One network attempt. Returns `{ status, headers, data?, error? }` for
   *   HTTP responses (4xx/5xx included — the gate inspects them); throws for
   *   non-HTTP failures (network), which propagate immediately.
   * @returns {Promise<any>} the attempt's `data` (or the result for 2xx)
   * @throws {RateLimitedError} when the limit cannot be resumed within the
   *   horizon (carries `resumeAt`, `retryAfterMs`; `code: 'RATE_LIMITED'`)
   */
  async function run(attempt) {
    await semaphore.acquire();
    try {
      let rateLimitedAttempts = 0;
      for (;;) {
        const waitMs = cooldownUntilMs - now();
        if (waitMs > 0) await sleep(waitMs);

        const result = await attempt();
        const kind = classifyLimit(result);

        if (kind !== null) {
          const parsed = parseRateLimitHeaders(result.headers);
          const resumeAtMs = computeResumeAt(parsed, now());
          rateLimitedAttempts += 1;
          if (resumeAtMs - now() > maxCooldownMs || rateLimitedAttempts >= maxRetries) {
            throw new RateLimitedError({
              resumeAt: new Date(Math.max(resumeAtMs, now())),
              retryAfterMs: parsed.retryAfterMs,
              kind,
              attempts: rateLimitedAttempts,
            });
          }
          cooldownUntilMs = Math.max(cooldownUntilMs, resumeAtMs);
          continue; // loop re-checks the cooldown, then retries
        }

        // Successful (or non-limit) response: pre-emptive low-quota pause for
        // subsequent requests.
        const parsed = parseRateLimitHeaders(result.headers);
        if (shouldPauseForLowQuota(parsed)) {
          const resumeAtMs =
            parsed.resetAt instanceof Date && parsed.resetAt.getTime() > now()
              ? parsed.resetAt.getTime()
              : now() + BACKOFF_BASE_MS;
          cooldownUntilMs = Math.max(cooldownUntilMs, resumeAtMs);
        }
        return result;
      }
    } finally {
      semaphore.release(); // exactly once per acquire, even on failure
    }
  }

  return { run, getStatus, concurrency, semaphore };
}

module.exports = { createRateLimitGate };
