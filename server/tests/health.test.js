/**
 * Health endpoint tests (tasks.md T0.2).
 * Uses an ephemeral listener + global fetch — no test-only HTTP dependency.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { createApp } = require('../src/app');

describe('GET /api/health', () => {
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

  it('returns the documented shape', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.version, 'string');
    assert.ok(['up', 'down'].includes(body.db));
    // GITHUB_CLIENT_ID is not set in this test env → reported as unconfigured.
    assert.equal(body.github, 'unconfigured');
    assert.equal(typeof body.uptime, 'number');
  });

  it('sets an X-Request-Id header', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.ok(res.headers.get('x-request-id'));
  });

  it('returns the error envelope on unknown routes', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(typeof body.error.message, 'string');
    assert.equal(body.error.retryable, false);
  });
});
