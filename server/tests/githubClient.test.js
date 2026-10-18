/**
 * GitHub client + rate-limit gate integration tests (tasks.md T2.1).
 *
 * A local fake GitHub server stands in for the real API (no live GitHub in
 * CI): verifies the decrypted token travels only in the Authorization header
 * and is never surfaced to the caller, that 403/429 pause + resume, that an
 * un-resumable limit surfaces RATE_LIMITED with the resume time, that a bare
 * 403 (permission/SSO) and 404 are NOT retried, and that concurrent requests
 * never exceed the default concurrency (2).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { encryptToken } = require('../src/services/auth/crypto.service');
const { createRateLimitGate } = require('../src/services/github/rateLimit');
const { createGithubClient } = require('../src/services/github/githubClient');

const FAKE_GITHUB_TOKEN = 'fake-gh-token-t21';
const userDoc = { githubTokenEnc: encryptToken(FAKE_GITHUB_TOKEN) };

function startFakeGithub() {
  const fake = { calls: [], queue: [], inFlight: 0, peak: 0, delayMs: 0 };
  const server = http.createServer((req, res) => {
    fake.calls.push({ url: req.url, auth: req.headers.authorization ?? null, at: Date.now() });
    fake.inFlight += 1;
    fake.peak = Math.max(fake.peak, fake.inFlight);
    const next = fake.queue.length > 0 ? fake.queue.shift() : null;
    const status = next ? next.status : 200;
    const headers = { 'Content-Type': 'application/json' };
    if (next && next.headers) Object.assign(headers, next.headers);
    setTimeout(() => {
      fake.inFlight -= 1;
      res.writeHead(status, headers);
      res.end(
        JSON.stringify(
          status === 200 ? { login: 'user-a', ok: true } : { message: 'simulated GitHub failure' }
        )
      );
    }, fake.delayMs);
  });
  return { fake, server };
}

describe('githubClient (tasks.md T2.1)', () => {
  let fake;
  let appServer;
  let fakeUrl;

  before(async () => {
    ({ fake, server: appServer } = startFakeGithub());
    await new Promise((resolve) => appServer.listen(0, resolve));
    fakeUrl = `http://127.0.0.1:${appServer.address().port}`;
    // getEnv() is a boot-time cache — mutating process.env after load has no
    // effect. The endpoint override is injected via the factory's documented
    // test seam (githubConfig) instead.
  });

  after(async () => {
    await new Promise((resolve) => {
      appServer.closeAllConnections?.();
      appServer.close(() => resolve());
    });
  });

  it('authenticates with the decrypted token and never surfaces it', async () => {
    const client = createGithubClient(userDoc, {
      gate: createRateLimitGate(),
      githubConfig: { apiBase: fakeUrl },
    });
    const data = await client.request('GET /user');
    assert.deepEqual(data, { login: 'user-a', ok: true });
    assert.equal(
      fake.calls[0].auth,
      `token ${FAKE_GITHUB_TOKEN}`,
      'the decrypted token must travel only in the Authorization header (memory-only)'
    );
    assert.ok(!JSON.stringify(data).includes(FAKE_GITHUB_TOKEN), 'the token must never reach the caller');
  });

  it('pauses on a 403 rate limit, waits the reset, then resumes successfully', async () => {
    fake.queue.push({
      status: 403,
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-limit': '5000',
        // +1500ms (not +400ms): x-ratelimit-reset is second-precision, so a
        // ~400ms horizon can truncate to nearly zero depending on millisecond
        // alignment, making the >=250ms assertion below flaky. With +1500ms
        // the actual wait is always in [~500ms, 1500ms]. Assertion unchanged.
        'x-ratelimit-reset': String(Math.floor((Date.now() + 1500) / 1000)),
      },
    });
    const gate = createRateLimitGate();
    const client = createGithubClient(userDoc, { gate, githubConfig: { apiBase: fakeUrl } });
    const callsBefore = fake.calls.length;
    const t0 = Date.now();
    const data = await client.request('GET /user');
    const elapsed = Date.now() - t0;
    assert.deepEqual(data, { login: 'user-a', ok: true });
    assert.equal(
      fake.calls.length,
      callsBefore + 2,
      'the paused request must be retried exactly once after the cooldown lapses'
    );
    assert.ok(elapsed >= 250, `expected a ~400ms pause, got ${elapsed}ms`);
    assert.equal(gate.getStatus().status, 'OK', 'the cooldown must clear after the reset');
  });

  it('surfaces RATE_LIMITED with the resume time when the limit cannot be resumed', async () => {
    fake.queue.push({ status: 429, headers: { 'retry-after': '3600' } });
    const callsBefore = fake.calls.length;
    const client = createGithubClient(userDoc, {
      gate: createRateLimitGate({ maxCooldownMs: 2000 }),
      githubConfig: { apiBase: fakeUrl },
    });
    await assert.rejects(client.request('GET /user'), (err) => {
      assert.equal(err.code, 'RATE_LIMITED');
      assert.equal(err.retryable, true);
      assert.ok(err.resumeAt instanceof Date && err.resumeAt.getTime() > Date.now() + 3000000);
      assert.equal(err.retryAfterMs, 3600000);
      assert.ok(!err.message.includes(FAKE_GITHUB_TOKEN), 'the error must never carry the token');
      return true;
    });
    assert.equal(fake.calls.length, callsBefore + 1, 'no retry when the resume time exceeds the horizon');
  });

  it('propagates a bare 403 (permission/SSO) as UNAUTHENTICATED without retrying', async () => {
    fake.queue.push({ status: 403 });
    const callsBefore = fake.calls.length;
    const client = createGithubClient(userDoc, {
      gate: createRateLimitGate(),
      githubConfig: { apiBase: fakeUrl },
    });
    await assert.rejects(client.request('GET /user'), (err) => {
      assert.equal(err.code, 'UNAUTHENTICATED');
      assert.equal(err.retryable, false);
      return true;
    });
    assert.equal(
      fake.calls.length,
      callsBefore + 1,
      'a permission 403 is not a rate limit and must not be retried'
    );
  });

  it('maps 404 to NOT_FOUND', async () => {
    fake.queue.push({ status: 404 });
    const client = createGithubClient(userDoc, {
      gate: createRateLimitGate(),
      githubConfig: { apiBase: fakeUrl },
    });
    await assert.rejects(client.request('GET /repos/ghost'), (err) => err.code === 'NOT_FOUND');
  });

  it('never lets concurrent requests exceed the default concurrency of 2', async () => {
    fake.delayMs = 60;
    const client = createGithubClient(userDoc, {
      gate: createRateLimitGate(),
      githubConfig: { apiBase: fakeUrl },
    });
    const before = fake.calls.length;
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => client.request('GET /user')));
    results.forEach((data) => assert.equal(data.login, 'user-a'));
    assert.equal(fake.calls.length, before + 6, 'all six requests must complete');
    assert.equal(fake.peak, 2, 'peak in-flight must be exactly the configured concurrency (2)');
  });

  it('requestWithHeaders returns data + headers + status through the same gate', async () => {
    fake.queue.push({
      status: 200,
      headers: { Link: '<http://example.com/page2>; rel="next"' },
    });
    const gate = createRateLimitGate();
    const client = createGithubClient(userDoc, { gate, githubConfig: { apiBase: fakeUrl } });
    const result = await client.requestWithHeaders('GET /user/repos');
    assert.deepEqual(result.data, { login: 'user-a', ok: true });
    assert.equal(result.status, 200);
    assert.ok(result.headers.link.includes('rel="next"'), 'Link header must reach the caller');
    assert.ok(!JSON.stringify(result).includes(FAKE_GITHUB_TOKEN), 'the token must never surface');
  });

  it('requestWithHeaders preserves the typed error mapping', async () => {
    fake.queue.push({ status: 404 });
    const client = createGithubClient(userDoc, {
      gate: createRateLimitGate(),
      githubConfig: { apiBase: fakeUrl },
    });
    await assert.rejects(client.requestWithHeaders('GET /repos/ghost'), (err) => err.code === 'NOT_FOUND');
  });

  it('defaults the concurrency to the validated env value (2)', () => {
    const client = createGithubClient(userDoc); // shared gate, env default
    assert.equal(client.gate.concurrency, 2);
  });

  it('rejects clients without a stored, decryptable token', () => {
    assert.throws(
      () => createGithubClient({}),
      (err) => err.code === 'UNAUTHENTICATED'
    );
    assert.throws(
      () => createGithubClient({ githubTokenEnc: 'garbage-payload' }),
      (err) => err.code === 'UNAUTHENTICATED'
    );
  });
});
