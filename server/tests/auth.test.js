/**
 * OAuth flow integration tests (tasks.md T1.1) + T1.2 login persistence.
 *
 * A local fake server stands in for the GitHub token + user endpoints —
 * no live GitHub in CI (acceptance: "mocked token endpoint"). MongoDB, when
 * available, is exercised for the user upsert + session persistence; when
 * unavailable, those tests skip without failing the suite.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const FAKE_ACCESS_TOKEN = 'fake-oauth-access-token-do-not-leak';
const FAKE_GITHUB_ID = 4242;

// Mutable fake behavior, switched per test.
const fake = {
  behavior: 'ok', // 'ok' | 'denied' | 'socket-error'
  tokenCalls: 0,
  // The raw body of the most recent token request, so a test can assert the
  // exchange carried the same redirect_uri as the authorization request.
  lastTokenBody: '',
};

function startFakeGithub() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/token') {
      fake.tokenCalls += 1;
      if (fake.behavior === 'socket-error') {
        req.socket.destroy();
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        fake.lastTokenBody = body;
        assert.ok(body.includes('code=test-auth-code'), 'code must be sent in the token request');
        if (fake.behavior === 'denied') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: 'access_denied', error_description: 'The user denied the request' })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ access_token: FAKE_ACCESS_TOKEN, token_type: 'bearer', scope: 'read:user repo' })
        );
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/user') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: FAKE_GITHUB_ID,
          login: 'synthetic-octocat',
          avatar_url: 'https://avatars.example/synthetic.png',
          html_url: 'https://github.com/synthetic-octocat',
        })
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
  });
  return server;
}

describe('GET /api/auth/github + /callback (tasks.md T1.1)', () => {
  let appServer;
  let fakeServer;
  let baseUrl;
  let fakeUrl;
  let dbUp = false;

  /** Full Set-Cookie string for `name` (attributes included). */
  function cookieFull(res, name) {
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return cookies.find((c) => c.startsWith(`${name}=`)) ?? null;
  }

  async function startFlow() {
    const res = await fetch(`${baseUrl}/api/auth/github`, { redirect: 'manual' });
    const stateCookie = cookieFull(res, 'fd_oauth_state');
    assert.ok(stateCookie, 'state cookie must be set on authorize redirect');
    const cookieValue = stateCookie.split(';')[0].replace('fd_oauth_state=', '');
    const decodedCookieValue = decodeURIComponent(cookieValue);
    const state = decodedCookieValue.split(':')[0];
    return { startRes: res, state, cookieValue: decodedCookieValue };
  }

  before(async () => {
    fakeServer = startFakeGithub();
    await new Promise((resolve) => fakeServer.listen(0, resolve));
    fakeUrl = `http://127.0.0.1:${fakeServer.address().port}`;

    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-16+';
    process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
    process.env.GITHUB_CLIENT_ID = 'test-gh-client';
    process.env.GITHUB_CLIENT_SECRET = 'test-gh-secret';
    process.env.GITHUB_TOKEN_URL = `${fakeUrl}/token`;
    process.env.GITHUB_API_USER_URL = `${fakeUrl}/user`;
    // Route every GitHub call in this suite at the local fake so startSync
    // (triggered in the background by the OAuth callback) never reaches the
    // real GitHub API and keeps no external connection alive.
    process.env.GITHUB_API_BASE = fakeUrl;
    // Point MongoDB at the isolated local test database (never the live
    // deployment URI from .env). Required so the INC-1 guard accepts the
    // connection and dbUp reflects real local availability.
    require('./helpers/dbTestTarget').useTestDatabase('frieday_test_configdb');

    const db = require('../src/config/db');
    const { connectForTest } = require('./helpers/dbTestTarget');
    try {
      // INC-1 guard (pre-flight): the resolved target is validated BEFORE any
      // connection attempt, so a production-targeting MONGO_URI never opens a
      // socket to production.
      await Promise.race([
        connectForTest(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('db wait timeout')), 5000)),
      ]);
      dbUp = db.dbStatus() === 'up';
    } catch {
      dbUp = false;
    }

    const { createApp } = require('../src/app');
    appServer = createApp().listen(0);
    await new Promise((resolve) => appServer.on('listening', resolve));
    baseUrl = `http://127.0.0.1:${appServer.address().port}`;
  });

  after(async () => {
    const mongoose = require('mongoose');
    if (dbUp) {
      const User = require('../src/models/User');
      await User.deleteMany({ githubId: FAKE_GITHUB_ID }).catch(() => {});
    }
    await new Promise((resolve) => {
      mongoose.disconnect().then(resolve).catch(resolve);
    });
    await new Promise((resolve) => {
      appServer.closeAllConnections?.();
      appServer.close(resolve);
    });
    await new Promise((resolve) => {
      fakeServer.closeAllConnections?.();
      fakeServer.close(() => resolve());
    });
  });

  it('redirects to GitHub authorize with a matching httpOnly state cookie', async () => {
    const { startRes, state, cookieValue } = await startFlow();
    assert.equal(startRes.status, 302);
    const location = startRes.headers.get('location');
    assert.ok(location.startsWith('https://github.com/login/oauth/authorize?'));
    assert.ok(location.includes('client_id=test-gh-client'));
    const query = new URLSearchParams(location.split('?')[1]);
    assert.equal(query.get('state'), state);
    assert.equal(query.get('redirect_uri'), 'http://localhost:5000/api/auth/github/callback');
    const stateCookie = cookieFull(startRes, 'fd_oauth_state');
    assert.ok(stateCookie, 'state cookie must be set on authorize redirect');
    assert.ok(/HttpOnly/i.test(stateCookie), 'state cookie must be httpOnly');
    assert.ok(/Path=\/api\/auth/i.test(stateCookie), 'state cookie scoped to /api/auth');
    assert.ok(!/Secure/i.test(stateCookie), 'Secure flag is production-only');
    // Cookie value is signed: state:expiresAt:signature
    const parts = cookieValue.split(':');
    assert.equal(parts.length, 3, 'signed cookie must have 3 colon-separated parts');
    assert.equal(parts[0], state, 'first part of cookie value must equal the state');
  });

  it('completes the flow: session cookies + redirect, token never reaches the client', async (t) => {
    if (!dbUp) {
      t.skip('login now persists session state, which requires MongoDB');
      return;
    }
    fake.behavior = 'ok';
    const callsBefore = fake.tokenCalls;
    const { startRes, state, cookieValue } = await startFlow();

    const res = await fetch(
      `${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${encodeURIComponent(state)}`,
      {
        redirect: 'manual',
        headers: { Cookie: `fd_oauth_state=${cookieValue}` },
      }
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/dashboard?connected=1');
    assert.equal(fake.tokenCalls, callsBefore + 1);

    const access = cookieFull(res, 'fd_access');
    const refresh = cookieFull(res, 'fd_refresh');
    assert.ok(access, 'fd_access cookie must be set');
    assert.ok(refresh, 'fd_refresh cookie must be set');
    assert.ok(/HttpOnly/i.test(access), 'fd_access must be httpOnly');
    assert.ok(/HttpOnly/i.test(refresh), 'fd_refresh must be httpOnly');
    // State cookie must be cleared (empty value), not re-issued with a new value.
    const setCookies = res.headers.getSetCookie() || [];
    const stateCookieReissued = setCookies.some((c) => {
      const m = c.match(/^fd_oauth_state=([^;]*)/);
      return m && m[1].length > 0;
    });
    assert.ok(!stateCookieReissued, 'state cookie must not be re-issued with a new value');

    const session = require('../src/services/auth/session.service');
    const accessValue = access.split(';')[0].replace('fd_access=', '');
    const refreshValue = refresh.split(';')[0].replace('fd_refresh=', '');
    const accessClaims = session.verifyAccess(accessValue);
    const refreshClaims = session.verifyRefresh(refreshValue);
    assert.ok(accessClaims, 'fd_access must be a valid access JWT');
    assert.ok(refreshClaims, 'fd_refresh must be a valid refresh JWT');
    assert.equal(accessClaims.sid, refreshClaims.sid, 'both cookies must share one session id');

    // No token material anywhere in the client-facing responses.
    const surface = [];
    for (const [, value] of res.headers.entries()) {
      surface.push(value);
    }
    surface.push(...res.headers.getSetCookie());
    surface.push(await res.text(), startRes.headers.get('location'));
    for (const text of surface) {
      assert.ok(!text.includes(FAKE_ACCESS_TOKEN), 'access token leaked into a client response');
    }

    const crypto = require('node:crypto');
    const User = require('../src/models/User');
    const { decryptToken } = require('../src/services/auth/crypto.service');
    const doc = await User.findOne({ githubId: FAKE_GITHUB_ID })
      .select('+githubTokenEnc +refreshTokenHash')
      .lean();
    assert.ok(doc, 'user document must be persisted after login');
    assert.equal(doc.login, 'synthetic-octocat');
    assert.ok(doc.githubTokenEnc.startsWith('v1:'), 'stored token must be an encrypted payload');
    assert.notEqual(doc.githubTokenEnc, FAKE_ACCESS_TOKEN, 'raw token must never be stored');
    assert.equal(
      decryptToken(doc.githubTokenEnc),
      FAKE_ACCESS_TOKEN,
      'stored token must decrypt to the raw token'
    );
    assert.equal(doc.sessionId, accessClaims.sid, 'persisted session id must match the access JWT');
    assert.equal(
      doc.refreshTokenHash,
      crypto.createHash('sha256').update(refreshValue).digest('hex'),
      'persisted refresh hash must match the issued refresh cookie'
    );
    assert.deepEqual(doc.scopes, ['read:user', 'repo']);
    assert.ok(doc.tokenUpdatedAt instanceof Date);
  });

  it('exchanges the code with the SAME redirect_uri it authorized with', async (t) => {
    if (!dbUp) {
      t.skip('login now persists session state, which requires MongoDB');
      return;
    }
    fake.behavior = 'ok';
    const { startRes, state, cookieValue } = await startFlow();

    // The redirect_uri the authorization request carried.
    const authorizeRedirect = new URL(startRes.headers.get('location'));
    const authorizeRedirectUri = authorizeRedirect.searchParams.get('redirect_uri');
    assert.equal(authorizeRedirectUri, 'http://localhost:5000/api/auth/github/callback');

    await fetch(
      `${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${encodeURIComponent(state)}`,
      {
        redirect: 'manual',
        headers: { Cookie: `fd_oauth_state=${cookieValue}` },
      }
    );

    // The token exchange must carry the identical redirect_uri. If the two
    // ever drift, GitHub rejects the exchange with
    // "redirect_uri ... does not match the one used in the authorization request".
    const exchange = new URLSearchParams(fake.lastTokenBody);
    assert.equal(
      exchange.get('redirect_uri'),
      authorizeRedirectUri,
      'the token exchange must use the same redirect_uri as the authorization request'
    );
    assert.equal(exchange.get('client_id'), 'test-gh-client');
  });

  it('redirects to the login page with error=db_unavailable when persistence fails', async (t) => {
    if (dbUp) {
      t.skip('requires an unavailable MongoDB');
      return;
    }
    fake.behavior = 'ok';
    const { state, cookieValue } = await startFlow();
    const res = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login?error=db_unavailable');
  });

  it('rejects an unknown state without calling the token endpoint (CSRF)', async () => {
    fake.behavior = 'ok';
    const callsBefore = fake.tokenCalls;
    const res = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=deadbeef`, {
      redirect: 'manual',
      headers: { Cookie: 'fd_oauth_state=deadbeef' },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.equal(fake.tokenCalls, callsBefore, 'no token exchange on state mismatch');
  });

  it('rejects a callback whose state cookie is missing', async () => {
    fake.behavior = 'ok';
    const callsBefore = fake.tokenCalls;
    const { state } = await startFlow();
    const res = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
    });
    assert.equal(res.status, 403);
    assert.equal(fake.tokenCalls, callsBefore, 'no token exchange without the state cookie');
  });

  it('rejects a callback without an authorization code', async () => {
    fake.behavior = 'ok';
    const callsBefore = fake.tokenCalls;
    const { state, cookieValue } = await startFlow();
    const res = await fetch(`${baseUrl}/api/auth/github/callback?state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(res.status, 403);
    assert.equal(fake.tokenCalls, callsBefore);
  });

  it('treats each state as single-use', async () => {
    fake.behavior = 'ok';
    const { state, cookieValue } = await startFlow();
    const first = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(first.status, 302);
    const second = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(second.status, 403);
  });

  it('redirects a denied authorization to the login page with error=denied', async () => {
    fake.behavior = 'denied';
    const { state, cookieValue } = await startFlow();
    const res = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login?error=denied');
  });

  it('redirects a token-endpoint failure to the login page with error=exchange_failed', async () => {
    fake.behavior = 'socket-error';
    const { state, cookieValue } = await startFlow();
    const res = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login?error=exchange_failed');
    fake.behavior = 'ok';
  });

  it('concurrent login tabs: second tab overwrites the state cookie, first tab callback mismatches (documented limitation)', async () => {
    // Tab 1 starts a flow -> cookie holds stateA
    const { state: stateA } = await startFlow();
    // Tab 2 starts a flow -> cookie is overwritten with stateB
    const { state: stateB, cookieValue: cookieB } = await startFlow();
    const callsBefore = fake.tokenCalls;
    // Tab 1's callback sends stateA but cookie now holds stateB -> mismatch -> 403
    const res = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${stateA}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieB}` },
    });
    assert.equal(res.status, 403);
    assert.equal(fake.tokenCalls, callsBefore, 'no token exchange on cookie/state mismatch');
    // Tab 2's callback succeeds with its own state+cookie
    const resB = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${stateB}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieB}` },
    });
    assert.equal(resB.status, 302);
    assert.equal(fake.tokenCalls, callsBefore + 1, 'tab 2 callback exchanges the code once');
  });

  it('POST /api/auth/logout clears session cookies and returns 204', async (t) => {
    if (!dbUp) {
      t.skip('logout requires DB-backed session');
      return;
    }
    // Login first to get session cookies
    const { state, cookieValue } = await startFlow();
    const loginRes = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(loginRes.status, 302);
    const accessCookie = cookieFull(loginRes, 'fd_access');
    const refreshCookie = cookieFull(loginRes, 'fd_refresh');
    assert.ok(accessCookie, 'fd_access cookie must be set');
    assert.ok(refreshCookie, 'fd_refresh cookie must be set');

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `${accessCookie}; ${refreshCookie}` },
    });
    assert.equal(logoutRes.status, 204);

    // Verify cookies are cleared
    const setCookies = logoutRes.headers.getSetCookie() || [];
    const accessCleared = setCookies.some((c) => c.startsWith('fd_access='));
    const refreshCleared = setCookies.some((c) => c.startsWith('fd_refresh='));
    assert.ok(accessCleared, 'fd_access cookie should be cleared on logout');
    assert.ok(refreshCleared, 'fd_refresh cookie should be cleared on logout');

    // Verify session is invalidated - refresh should fail
    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `fd_refresh=${refreshCookie.split(';')[0]}` },
    });
    assert.equal(refreshRes.status, 401);
  });

  it('POST /api/auth/disconnect clears GitHub token, keeps Frieday session alive', async (t) => {
    if (!dbUp) {
      t.skip('disconnect requires DB-backed session');
      return;
    }
    // Login first
    const { state, cookieValue } = await startFlow();
    const loginRes = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(loginRes.status, 302);
    const accessCookie = cookieFull(loginRes, 'fd_access');
    assert.ok(accessCookie, 'fd_access cookie must be set');

    // Disconnect returns 200 with revocation status (not 204)
    const disconnectRes = await fetch(`${baseUrl}/api/auth/disconnect`, {
      method: 'POST',
      headers: { Cookie: accessCookie },
    });
    assert.equal(disconnectRes.status, 200, 'disconnect must return 200 with revocation status');
    const body = await disconnectRes.json();
    assert.equal(body.disconnected, true, 'disconnected flag must be true');

    // The GitHub token is cleared: /me reports disconnected.
    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `fd_access=${accessCookie.split(';')[0].replace('fd_access=', '')}` },
    });
    assert.equal(me.status, 200, '/me must still work after disconnect');
    const meBody = await me.json();
    assert.equal(meBody.connected, false, '/me must report disconnected');

    // The Frieday session is STILL alive: refresh still works.
    const refreshCookie = cookieFull(loginRes, 'fd_refresh');
    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: refreshCookie.split(';')[0] },
    });
    assert.equal(refreshRes.status, 200, 'refresh must still work after disconnect — session is kept alive');
  });

  it('DELETE /api/auth/data removes all user data and returns counts', async (t) => {
    if (!dbUp) {
      t.skip('delete-data requires DB-backed session');
      return;
    }
    // Login first
    const { state, cookieValue } = await startFlow();
    const loginRes = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(loginRes.status, 302);
    const accessCookie = cookieFull(loginRes, 'fd_access');
    assert.ok(accessCookie, 'fd_access cookie must be set');

    // Delete data
    const deleteRes = await fetch(`${baseUrl}/api/auth/data`, {
      method: 'DELETE',
      headers: { Cookie: accessCookie },
    });
    assert.equal(deleteRes.status, 200);
    const body = await deleteRes.json();
    assert.ok(body.deleted, 'delete response should include deleted counts');
    assert.ok(typeof body.deleted === 'object', 'deleted should be an object');
  });

  it('POST /api/auth/refresh with revoked token returns 401', async (t) => {
    if (!dbUp) {
      t.skip('refresh requires DB-backed session');
      return;
    }
    // Login first
    const { state, cookieValue } = await startFlow();
    const loginRes = await fetch(`${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `fd_oauth_state=${cookieValue}` },
    });
    assert.equal(loginRes.status, 302);
    const accessCookie = cookieFull(loginRes, 'fd_access');
    const refreshCookie = cookieFull(loginRes, 'fd_refresh');
    assert.ok(accessCookie, 'fd_access cookie must be set');
    assert.ok(refreshCookie, 'fd_refresh cookie must be set');

    // Disconnect first to revoke token
    await fetch(`${baseUrl}/api/auth/disconnect`, {
      method: 'POST',
      headers: { Cookie: `${accessCookie}; ${refreshCookie}` },
    });

    // Try to refresh with revoked token - should fail
    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `fd_refresh=${refreshCookie.split(';')[0]}` },
    });
    assert.equal(refreshRes.status, 401);
    const body = await refreshRes.json();
    assert.ok(body.error, 'refresh should return error on revoked token');
  });
});

describe('User.upsertOne', () => {
  let dbUp = false;

  before(async () => {
    const db = require('../src/config/db');
    const { connectForTest } = require('./helpers/dbTestTarget');
    try {
      // INC-1 guard (pre-flight): the resolved target is validated BEFORE any
      // connection attempt, so a production-targeting MONGO_URI never opens a
      // socket to production.
      await Promise.race([
        connectForTest(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('db wait timeout')), 5000)),
      ]);
      dbUp = db.dbStatus() === 'up';
    } catch {
      dbUp = false;
    }
  });

  after(async () => {
    // Deterministic teardown: this describe opens its own mongoose connection
    // in `before()`; close it so the process can exit after the suite.
    await new Promise((resolve) => {
      require('mongoose').disconnect().then(resolve).catch(resolve);
    });
  });

  it('upserts idempotently on githubId and stores the token out of default selects', async (t) => {
    if (!dbUp) {
      t.skip('MongoDB is not available in this environment');
      return;
    }
    const User = require('../src/models/User');
    const { encryptToken, decryptToken } = require('../src/services/auth/crypto.service');
    const record = {
      githubId: FAKE_GITHUB_ID,
      login: 'synthetic-octocat',
      avatarUrl: 'https://avatars.example/synthetic.png',
      profileUrl: 'https://github.com/synthetic-octocat',
      token: encryptToken(FAKE_ACCESS_TOKEN),
      scopes: ['read:user', 'repo'],
    };
    await User.upsertOne(record);
    await User.upsertOne({ ...record, login: 'renamed-octocat', token: encryptToken('rotated-token') });

    const docs = await User.find({ githubId: FAKE_GITHUB_ID }).lean();
    assert.equal(docs.length, 1, 're-upsert must not create a duplicate');
    assert.equal(docs[0].login, 'renamed-octocat');
    assert.equal(docs[0].githubTokenEnc, undefined, 'token must stay out of default selects');

    const full = await User.findOne({ githubId: FAKE_GITHUB_ID }).select('+githubTokenEnc').lean();
    assert.ok(full.githubTokenEnc.startsWith('v1:'), 'stored token must be an encrypted payload');
    assert.equal(decryptToken(full.githubTokenEnc), 'rotated-token');
  });
});

/**
 * Signed OAuth state validation (regression).
 *
 * These tests target the SIGNED-STATE design (see design review):
 *   beginAuth() returns cookieValue = `${state}:${expiresAt}:${signature}`
 *   verifyState(state, cookieValue) validates HMAC signature, expiry, and single-use.
 *
 * They are written FIRST (test-first) against the NOT-YET-IMPLEMENTED design and
 * therefore FAIL against the current in-memory Map implementation. This is expected.
 * They document the gap that the OAuth state fix must close.
 */
describe('Signed OAuth state validation (regression, test-first)', () => {
  const crypto = require('node:crypto');
  const { createOAuthService } = require('../src/services/auth/oauth.service');

  const STATE_TTL_MS = 10 * 60 * 1000;

  // Set env required by getEnv() validation inside createOAuthService/beginAuth.
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-16+';
  process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

  const oauth = createOAuthService();

  function makeSignedCookie(state, expiresAt, secret = process.env.JWT_SECRET) {
    const payload = `${state}:${expiresAt}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${state}:${expiresAt}:${sig}`;
  }

  it('beginAuth() returns a signed cookieValue (state:expiresAt:signature)', () => {
    const result = oauth.beginAuth();
    assert.ok(result.state, 'state must be generated');
    assert.ok(result.authorizationUrl, 'authorizationUrl must be generated');
    assert.ok(result.cookieValue, 'cookieValue must be present (signed cookie format)');
    const parts = result.cookieValue.split(':');
    assert.equal(parts.length, 3, 'cookieValue must have 3 colon-separated parts');
    assert.equal(parts[0], result.state, 'first part must equal the state');
    assert.notEqual(parts[2], '', 'third part must be a non-empty signature');
  });

  it('verifies a valid fresh signed state', () => {
    const { state, cookieValue } = oauth.beginAuth();
    assert.ok(oauth.verifyState(state, cookieValue), 'valid signed state must verify');
  });

  it('rejects a mismatched state (query state !== cookie state)', () => {
    const { state: stateA, cookieValue: cookieA } = oauth.beginAuth();
    const { state: stateB } = oauth.beginAuth();
    assert.ok(!oauth.verifyState(stateB, cookieA), 'query stateB with cookie stateA must fail');
    assert.ok(
      !oauth.verifyState(stateA, makeSignedCookie(stateB, Date.now() + STATE_TTL_MS)),
      'cookie stateB with query stateA must fail'
    );
  });

  it('rejects an expired signed state', () => {
    const expiredCookie = makeSignedCookie('some-state', Date.now() - STATE_TTL_MS - 1000);
    assert.ok(!oauth.verifyState('some-state', expiredCookie), 'expired state must not verify');
  });

  it('rejects a tampered signature', () => {
    const { state, cookieValue } = oauth.beginAuth();
    const parts = cookieValue.split(':');
    const tampered = `${parts[0]}:${parts[1]}:tampered-signature-${Date.now()}`;
    assert.ok(!oauth.verifyState(state, tampered), 'tampered signature must not verify');
  });

  it('consumes a state after successful verification (single-use)', () => {
    const { state, cookieValue } = oauth.beginAuth();
    assert.ok(oauth.verifyState(state, cookieValue), 'first verification must succeed');
    assert.ok(!oauth.verifyState(state, cookieValue), 'second verification (replay) must fail');
  });
});
