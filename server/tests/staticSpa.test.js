/**
 * T9.1 deployment test: Express serving the production client build (Option A).
 *
 * The production flow is Browser → same-origin frontend → /api → server →
 * MongoDB/GitHub. The server must (a) serve the built SPA's assets, (b) fall
 * back to index.html for client-side routes (/, /dashboard, ...), and (c) NEVER
 * swallow /api/* — unknown API routes must keep the JSON error envelope
 * (rules.md §5, health/authMatrix 404 contracts).
 *
 * The SPA middleware is exercised deterministically against a temp fixture
 * dist; the composed createApp() is asserted for the always-valid /api
 * behavior (and SPA routes when a real build exists).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { createApp, DEFAULT_CLIENT_DIST, hasClientBuild, spaMiddleware } = require('../src/app');

function makeFixtureDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frieday-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root">SPA</div>');
  fs.writeFileSync(path.join(dir, 'assets-app-abc123.js'), 'console.log("app");');
  return dir;
}

describe('T9.1 spaMiddleware (fixture dist, deterministic)', () => {
  let distDir;
  let server;
  let baseUrl;

  before(async () => {
    distDir = makeFixtureDist();
    const app = express();
    app.use(spaMiddleware(distDir));
    app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', retryable: false } }));
    server = app.listen(0);
    await new Promise((resolve) => server.on('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('detects a usable client build by index.html', () => {
    assert.equal(hasClientBuild(distDir), true);
    assert.equal(hasClientBuild(os.tmpdir()), false);
  });

  it('serves index.html at the SPA root', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await res.text(), /SPA/);
  });

  it('falls back to index.html for client-side routes (no /api prefix)', async () => {
    for (const route of ['/dashboard', '/timeline', '/repositories', '/settings', '/repositories/abc123']) {
      const res = await fetch(`${baseUrl}${route}`);
      assert.equal(res.status, 200, `GET ${route} must serve the SPA shell`);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    }
  });

  it('serves built asset files directly (hashed filenames unaffected by fallback)', async () => {
    const res = await fetch(`${baseUrl}/assets-app-abc123.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /javascript/);
    assert.equal(await res.text(), 'console.log("app");');
  });

  it('passes /api/* through to the JSON error envelope (never swallowed)', async () => {
    const res = await fetch(`${baseUrl}/api/whatever`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('passes non-GET requests through', async () => {
    const res = await fetch(`${baseUrl}/anything`, { method: 'POST' });
    assert.equal(res.status, 404);
  });
});

describe('T9.1 composed createApp() (real server wiring)', () => {
  let server;
  let baseUrl;
  const buildPresent = hasClientBuild(DEFAULT_CLIENT_DIST);

  before(async () => {
    const app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.on('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('keeps /api/health working through the composed app', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it('keeps unknown /api routes on the JSON error envelope', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it(
    'serves the SPA shell at / when a client build exists',
    { skip: !buildPresent && 'no client build present' },
    async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    }
  );

  it(
    'falls back to index.html for /dashboard when a client build exists',
    { skip: !buildPresent && 'no client build present' },
    async () => {
      const res = await fetch(`${baseUrl}/dashboard`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    }
  );
});
