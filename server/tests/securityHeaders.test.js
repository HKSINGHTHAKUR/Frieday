/**
 * Security-header baseline regression test (tasks.md T8.1 sweep + T8.2 audit).
 *
 * prd.md §21/§23 + rules.md §9 require helmet + restrictive CORS + CSP +
 * HSTS. T8.2 enabled the Content-Security-Policy (app.js) tuned to the built
 * SPA: script-src 'self' (one external module script), style-src 'self'
 * 'unsafe-inline' (React style attributes), img-src with GitHub's avatar CDN,
 * connect-src 'self', object-src 'none', frame-ancestors 'self'. This test
 * pins that baseline so a regression (a careless app.js change) is caught.
 *
 * Uses an ephemeral listener + global fetch — no live DB, no live GitHub.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { createApp } = require('../src/app');

describe('security headers (helmet baseline, T8.1 sweep + T8.2 audit)', () => {
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

  it('sends the helmet security baseline on API responses', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    // Content-type confusion protection
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    // Clickjacking protection
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    // HSTS (browsers honor it on HTTPS; helmet sets it unconditionally)
    assert.match(res.headers.get('strict-transport-security'), /max-age=\d+/);
    assert.ok(res.headers.get('strict-transport-security').includes('includeSubDomains'));
    // No referrer leakage
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    // Cross-origin isolation + resource policy
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
    // Legacy/plugin surface reduction
    assert.equal(res.headers.get('x-permitted-cross-domain-policies'), 'none');
    assert.equal(res.headers.get('x-dns-prefetch-control'), 'off');
  });

  it('enforces a Content-Security-Policy compatible with the built SPA', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'Content-Security-Policy header must be present');
    // Script injection blocked: only same-origin scripts, no inline/eval.
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /frame-ancestors 'self'/);
    // React style="" attributes need unsafe-inline in style-src (styles only —
    // never script-src).
    assert.match(csp, /style-src [^;]*'unsafe-inline'/);
    // The SPA's only third-party subresource: GitHub avatar images.
    assert.match(csp, /img-src [^;]*avatars\.githubusercontent\.com/);
    // API calls stay same-origin.
    assert.match(csp, /connect-src 'self'/);
    // No loose https: fallbacks in font/style sources.
    assert.match(csp, /font-src 'self'(?! https:)/);
    assert.doesNotMatch(csp, /style-src [^;]*https:/);
  });

  it('keeps restrictive CORS: credentials allowed, origin from CLIENT_URL allowlist', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    // The test env defaults CLIENT_URL to the Vite dev origin; whatever it is,
    // it must echo a single allowlisted origin, never a bare wildcard with
    // credentials.
    const origin = res.headers.get('access-control-allow-origin');
    assert.ok(origin && origin !== '*', 'credentialed CORS must not use a wildcard origin');
  });

  it('does not leak stack traces in the error envelope', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(!('stack' in body.error), 'error envelope must not carry stack traces');
  });
});
