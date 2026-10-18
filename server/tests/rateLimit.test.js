/**
 * Rate-limit gate unit tests (tasks.md T2.1): header parsing (x-ratelimit-* +
 * Retry-After seconds/HTTP-date, fail-safe on malformed), primary/secondary
 * classification, resume-time math, <10% pre-emptive threshold, exponential
 * backoff + bounded jitter, FIFO semaphore, and gate pause/resume with an
 * injected clock — no real timers, no network, no live GitHub.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  RateLimitedError,
  parseRateLimitHeaders,
  classifyLimit,
  computeResumeAt,
  shouldPauseForLowQuota,
  computeBackoffMs,
  createSemaphore,
  createRateLimitGate,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  JITTER_MAX_MS,
} = require('../src/services/github/rateLimit');

const NULLS = { limit: null, remaining: null, resetAt: null, retryAfterMs: null };

describe('rateLimit: header parsing', () => {
  it('parses a full primary limit header set', () => {
    const resetSec = Math.floor((Date.now() + 60000) / 1000);
    const parsed = parseRateLimitHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '42',
      'x-ratelimit-reset': String(resetSec),
      'retry-after': '120',
    });
    assert.equal(parsed.limit, 5000);
    assert.equal(parsed.remaining, 42);
    assert.equal(parsed.resetAt.getTime(), resetSec * 1000);
    assert.equal(parsed.retryAfterMs, 120000);
  });

  it('parses Retry-After as HTTP-date', () => {
    const httpDate = new Date(Date.now() + 60000).toUTCString();
    const parsed = parseRateLimitHeaders({ 'retry-after': httpDate });
    assert.ok(parsed.retryAfterMs >= 54000 && parsed.retryAfterMs <= 60000, `got ${parsed.retryAfterMs}`);
  });

  it('fails safely on malformed or missing Retry-After values', () => {
    for (const bad of ['garbage', '-5', '', '1.5.5']) {
      assert.equal(parseRateLimitHeaders({ 'retry-after': bad }).retryAfterMs, null, `value: ${bad}`);
    }
  });

  it('returns all-null for empty/missing headers and non-integer limits', () => {
    assert.deepEqual(parseRateLimitHeaders({}), NULLS);
    assert.deepEqual(parseRateLimitHeaders(undefined), NULLS);
    assert.equal(parseRateLimitHeaders({ 'x-ratelimit-limit': 'abc' }).limit, null);
    assert.equal(parseRateLimitHeaders({ 'x-ratelimit-remaining': 'lots' }).remaining, null);
  });

  it('accepts Headers-like objects (Map with .get + iteration)', () => {
    const headersLike = new Map([['Retry-After', '30']]);
    assert.equal(parseRateLimitHeaders(headersLike).retryAfterMs, 30000);
  });
});

describe('rateLimit: classification', () => {
  it('classifies 403 with exhausted primary quota as primary', () => {
    assert.equal(classifyLimit({ status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'primary');
  });

  it('classifies 403 with Retry-After (quota not exhausted) as secondary', () => {
    assert.equal(
      classifyLimit({ status: 403, headers: { 'x-ratelimit-remaining': '50', 'retry-after': '60' } }),
      'secondary'
    );
  });

  it('classifies 429 as secondary even without headers', () => {
    assert.equal(classifyLimit({ status: 429, headers: {} }), 'secondary');
  });

  it('does NOT classify a bare 403 (permission/SSO) — it must propagate', () => {
    assert.equal(classifyLimit({ status: 403, headers: {} }), null);
  });

  it('ignores non-limit statuses and null results', () => {
    assert.equal(classifyLimit({ status: 200, headers: { 'retry-after': '60' } }), null);
    assert.equal(classifyLimit(null), null);
  });
});

describe('rateLimit: resume-time math', () => {
  const now = Date.now();

  it('uses the LATER of reset vs now+Retry-After', () => {
    assert.equal(computeResumeAt({ resetAt: new Date(now + 30000), retryAfterMs: 10000 }, now), now + 30000);
    assert.equal(computeResumeAt({ resetAt: new Date(now + 5000), retryAfterMs: 20000 }, now), now + 20000);
  });

  it('ignores a reset already in the past and uses Retry-After', () => {
    assert.equal(computeResumeAt({ resetAt: new Date(now - 5000), retryAfterMs: 20000 }, now), now + 20000);
  });

  it('falls back to the conservative base when no usable header exists', () => {
    assert.equal(computeResumeAt({ resetAt: null, retryAfterMs: null }, now), now + BACKOFF_BASE_MS);
  });
});

describe('rateLimit: pre-emptive low-quota threshold', () => {
  it('pauses below 10% of the primary limit (including zero remaining)', () => {
    assert.equal(shouldPauseForLowQuota({ limit: 100, remaining: 5 }), true);
    assert.equal(shouldPauseForLowQuota({ limit: 100, remaining: 0 }), true);
  });

  it('does not pause above the threshold or with unknown quota', () => {
    assert.equal(shouldPauseForLowQuota({ limit: 100, remaining: 15 }), false);
    assert.equal(shouldPauseForLowQuota({ limit: null, remaining: 0 }), false);
    assert.equal(shouldPauseForLowQuota({ limit: 100, remaining: null }), false);
  });
});

describe('rateLimit: exponential backoff', () => {
  it('is deterministic with zero jitter and doubles per attempt', () => {
    assert.equal(computeBackoffMs(0, { rng: () => 0 }), BACKOFF_BASE_MS);
    assert.equal(computeBackoffMs(3, { rng: () => 0 }), 8000);
  });

  it('caps the exponential part and adds bounded jitter', () => {
    assert.equal(computeBackoffMs(10, { rng: () => 0 }), BACKOFF_MAX_MS);
    assert.equal(computeBackoffMs(10, { rng: () => 1 }), BACKOFF_MAX_MS + JITTER_MAX_MS);
    assert.ok(computeBackoffMs(5, { rng: () => 0.5 }) <= BACKOFF_MAX_MS + JITTER_MAX_MS);
  });

  it('honors custom bounds', () => {
    assert.equal(computeBackoffMs(0, { baseMs: 100, maxMs: 300, jitterMs: 10, rng: () => 0 }), 100);
    assert.equal(computeBackoffMs(10, { baseMs: 100, maxMs: 300, jitterMs: 10, rng: () => 0.99 }), 309);
  });

  it('rejects invalid attempts', () => {
    for (const bad of [-1, 1.5, '2']) {
      assert.throws(() => computeBackoffMs(bad), TypeError);
    }
  });
});

describe('rateLimit: FIFO semaphore', () => {
  it('hands permits off in FIFO order on release', async () => {
    const sem = createSemaphore(2);
    const order = [];
    const pA = sem.acquire().then(() => order.push('A'));
    const pB = sem.acquire().then(() => order.push('B'));
    await Promise.all([pA, pB]);
    sem.acquire().then(() => order.push('C'));
    sem.acquire().then(() => order.push('D'));
    assert.equal(sem.active, 2);
    assert.equal(sem.queued, 2);
    sem.release(); // A's permit → C (first in line)
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(order, ['A', 'B', 'C']);
    sem.release(); // → D
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(order, ['A', 'B', 'C', 'D']);
    assert.equal(sem.active, 2);
    assert.equal(sem.queued, 0);
  });

  it('never exceeds the configured concurrency and releases all permits', async () => {
    const sem = createSemaphore(3);
    let inFlight = 0;
    let peak = 0;
    async function worker() {
      await sem.acquire();
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      sem.release();
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    assert.equal(peak, 3, 'the cap must be both enforced and reachable');
    assert.equal(sem.active, 0, 'no leaked permits after every release');
    assert.equal(sem.queued, 0);
  });

  it('releases correctly when the held work fails', async () => {
    const sem = createSemaphore(1);
    await sem.acquire();
    try {
      try {
        throw new Error('boom');
      } finally {
        sem.release();
      }
    } catch {
      // expected: the permit was released in the finally above
    }
    assert.equal(sem.active, 0);
    await sem.acquire(); // a leaked permit would deadlock this
    sem.release();
  });

  it('rejects invalid sizes', () => {
    assert.throws(() => createSemaphore(0), TypeError);
    assert.throws(() => createSemaphore(1.5), TypeError);
  });
});

describe('rateLimit: gate (injected clock, no network)', () => {
  function fakeClock() {
    let t = 0;
    const sleeps = [];
    return {
      now: () => t,
      sleeps,
      sleep: async (ms) => {
        t += ms;
        sleeps.push(ms);
      },
    };
  }

  it('pauses on a rate-limited response and resumes after the cooldown', async () => {
    const clock = fakeClock();
    const gate = createRateLimitGate({ now: clock.now, sleep: clock.sleep });
    let attempts = 0;
    const result = await gate.run(async () => {
      attempts += 1;
      if (attempts === 1) return { status: 429, headers: { 'retry-after': '100' } };
      return { status: 200, headers: {}, data: { ok: true } };
    });
    assert.deepEqual(result.data, { ok: true });
    assert.equal(attempts, 2);
    assert.deepEqual(clock.sleeps, [100000], 'the gate must sleep exactly the retry window');
    assert.equal(gate.getStatus().status, 'OK');
  });

  it('surfaces RATE_LIMITED with the resume time when the limit cannot be resumed in time', async () => {
    const clock = fakeClock();
    const gate = createRateLimitGate({ now: clock.now, sleep: clock.sleep, maxCooldownMs: 5000 });
    await assert.rejects(
      gate.run(async () => ({ status: 429, headers: { 'retry-after': '3600' } })),
      (err) => {
        assert.ok(err instanceof RateLimitedError);
        assert.equal(err.code, 'RATE_LIMITED');
        assert.equal(err.retryable, true);
        assert.equal(err.attempts, 1);
        assert.equal(err.retryAfterMs, 3600000);
        assert.equal(err.resumeAt.getTime(), 3600000);
        assert.equal(err.kind, 'secondary');
        assert.ok(!err.message.includes('fake-secret-token'), 'error must never carry credentials');
        return true;
      }
    );
    assert.deepEqual(clock.sleeps, [], 'no sleep when the resume time exceeds the horizon');
  });

  it('schedules a pre-emptive cooldown when primary quota drops below 10%', async () => {
    const clock = fakeClock();
    const gate = createRateLimitGate({ now: clock.now, sleep: clock.sleep });
    const result = await gate.run(async () => ({
      status: 200,
      headers: { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '10' },
      data: { ok: true },
    }));
    assert.deepEqual(result.data, { ok: true }, 'the low-quota response itself still succeeds');
    const status = gate.getStatus();
    assert.equal(status.status, 'RATE_LIMITED');
    assert.equal(status.resumeAt.getTime(), 10000);

    await gate.run(async () => ({ status: 200, headers: {}, data: { second: true } }));
    assert.deepEqual(clock.sleeps, [10000], 'the next request must wait out the pre-emptive cooldown');
  });

  it('starts OK and exposes the configured concurrency', () => {
    const gate = createRateLimitGate({ concurrency: 5 });
    assert.equal(gate.concurrency, 5);
    assert.deepEqual(gate.getStatus(), { status: 'OK', resumeAt: null, concurrency: 5 });
  });
});
