/**
 * Auth/authz matrix regression test (tasks.md T8.2).
 *
 * Unauthenticated requests to EVERY mounted endpoint must fail closed with
 * the documented envelope — except the documented public-by-design routes
 * (health; OAuth start/callback; webhook receiver gated by HMAC instead of a
 * session). requireAuth rejects a missing cookie BEFORE any database access,
 * so this matrix runs without MongoDB; authed/cross-user behavior is covered
 * by the DB-gated suites (skipped in this environment).
 *
 * Uses an ephemeral listener + global fetch.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
process.env.WEBHOOK_SECRET = 'hook-secret-for-tests-only';

const { createApp } = require('../src/app');

describe('auth matrix — every endpoint fails closed (T8.2)', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.on('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const authed = [
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/refresh'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/disconnect'],
    ['DELETE', '/api/auth/data'],
    ['POST', '/api/sync'],
    ['GET', '/api/sync/status'],
    ['GET', '/api/dashboard'],
    ['GET', '/api/dashboard?range=bogus', 'auth must precede query validation'],
    ['GET', '/api/repos'],
    ['GET', '/api/repos/123'],
    ['GET', '/api/timeline'],
    ['GET', '/api/insights'],
    ['POST', '/api/insights/x/explain'],
  ];

  for (const [method, path, note] of authed) {
    it(`${method} ${path} -> 401 UNAUTHENTICATED envelope${note ? ` (${note})` : ''}`, async () => {
      const res = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(res.status, 401, `${method} ${path} must fail closed`);
      const body = await res.json();
      assert.equal(body.error.code, 'UNAUTHENTICATED');
      assert.equal(body.error.retryable, false);
      assert.ok(!('stack' in body.error), 'no stack traces in error responses');
    });
  }

  it('GET /api/health stays public (documented)', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
  });

  it('GET /api/auth/github is the public OAuth entry (501 when unconfigured, never 401-gated)', async () => {
    // GITHUB_CLIENT_ID is unset in this test env -> documented 501 envelope.
    const res = await fetch(`${baseUrl}/api/auth/github`);
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_CONFIG');
  });

  it('GET /api/auth/github/callback fails closed on missing OAuth state (403, CSRF gate)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/github/callback?code=abc&state=forged`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  it('POST /api/webhooks/github is HMAC-gated (401 without a signature, not session 401)', async () => {
    const res = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-GitHub-Delivery': 'matrix-1',
      },
      body: JSON.stringify({ repository: { id: 1, full_name: 'o/r' } }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHENTICATED', 'HMAC failure uses the standard 401 envelope');
    assert.match(body.error.message, /signature/i);
  });

  it('wrong method on a POST-only endpoint fails closed (no method confusion)', async () => {
    const res = await fetch(`${baseUrl}/api/sync`, { method: 'GET' });
    assert.ok([401, 404].includes(res.status), 'GET /api/sync must not run the sync handler');
    if (res.status === 404) {
      const body = await res.json();
      assert.equal(body.error.code, 'NOT_FOUND');
    } else {
      const body = await res.json();
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    }
  });
});
