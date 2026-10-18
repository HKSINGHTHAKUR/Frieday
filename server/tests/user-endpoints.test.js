/**
 * User endpoint integration tests (tasks.md T1.2): /me, /refresh rotation +
 * reuse detection, /logout, /disconnect (best-effort revocation), /data
 * (full wipe + accurate counts on seeded data), cross-user isolation.
 *
 * A local fake server stands in for GitHub (token, user, grant revocation) —
 * no live GitHub in CI. Tests needing MongoDB skip when unavailable; the
 * cookie/validation tests run without a database.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const FAKE_ACCESS_TOKEN = 'fake-oauth-access-token-do-not-leak';
const USERS = {
  a: { id: 4242, login: 'user-a', avatar: 'https://avatars.example/a.png', url: 'https://github.com/user-a' },
  b: { id: 4243, login: 'user-b', avatar: 'https://avatars.example/b.png', url: 'https://github.com/user-b' },
};

const fake = {
  user: USERS.a,
  tokenCalls: 0,
  revocations: [],
};

function startFakeGithub() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/token') {
      fake.tokenCalls += 1;
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        assert.ok(body.includes('code=test-auth-code'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ access_token: FAKE_ACCESS_TOKEN, token_type: 'bearer', scope: 'read:user repo' })
        );
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/user') {
      const u = fake.user;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: u.id, login: u.login, avatar_url: u.avatar, html_url: u.url }));
      return;
    }
    if (req.method === 'DELETE' && req.url === '/applications/test-gh-client/grant') {
      fake.revocations.push({ auth: req.headers.authorization });
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
  });
  return server;
}

describe('user endpoints (tasks.md T1.2)', () => {
  let appServer;
  let fakeServer;
  let baseUrl;
  let fakeUrl;
  let dbUp = false;

  function cookieValue(res, name) {
    for (const c of res.headers.getSetCookie()) {
      if (c.startsWith(`${name}=`)) {
        return c.split(';')[0].slice(name.length + 1);
      }
    }
    return null;
  }

  async function startFlow() {
    const res = await fetch(`${baseUrl}/api/auth/github`, { redirect: 'manual' });
    const state = cookieValue(res, 'fd_oauth_state');
    assert.ok(state, 'state cookie must be set on authorize redirect');
    return state;
  }

  /** Complete a login for `fake.user`; returns the issued cookie values. */
  async function login() {
    const state = await startFlow();
    const res = await fetch(
      `${baseUrl}/api/auth/github/callback?code=test-auth-code&state=${encodeURIComponent(state)}`,
      { redirect: 'manual', headers: { Cookie: `fd_oauth_state=${state}` } }
    );
    assert.equal(res.status, 302, `login must succeed (got ${res.status})`);
    assert.equal(res.headers.get('location'), '/dashboard?connected=1');
    return { access: cookieValue(res, 'fd_access'), refresh: cookieValue(res, 'fd_refresh') };
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
    process.env.GITHUB_API_BASE = fakeUrl;

    const db = require('../src/config/db');
    try {
      await Promise.race([
        db.connectDb(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('db wait timeout')), 5000)),
      ]);
      dbUp = db.dbStatus() === 'up';
    } catch {
      dbUp = false;
    }
    if (dbUp) {
      // INC-1 guard: these suites create and delete users (including the
      // delete-data wipe), so they may only run against an isolated local
      // test database — never a live deployment URI (see INC-1).
      const host = require('mongoose').connection.host || '';
      const dbName = require('mongoose').connection.name || '';
      if (!(host === '127.0.0.1' || host === 'localhost') || !/test/i.test(dbName)) {
        dbUp = false;
      }
    }

    const { createApp } = require('../src/app');
    appServer = createApp().listen(0);
    await new Promise((resolve) => appServer.on('listening', resolve));
    baseUrl = `http://127.0.0.1:${appServer.address().port}`;
  });

  after(async () => {
    const mongoose = require('mongoose');
    if (dbUp) {
      // Cleanup is scoped to THIS file's synthetic users only (githubId
      // 4242/4243). These tests may run against a shared MongoDB — the
      // previous wipe-everything hook destroyed unrelated users' data when
      // pointed at a live database (T8.2 test-safety defect).
      const User = require('../src/models/User');
      const synthetic = await User.find({ githubId: { $in: [USERS.a.id, USERS.b.id] } })
        .select('_id')
        .lean();
      const ids = synthetic.map((u) => u._id);
      const db = mongoose.connection.db;
      for (const name of [
        'repositories',
        'commits',
        'pullrequests',
        'issues',
        'languagesnapshots',
        'activitybuckets',
        'insights',
        'syncstates',
        'syncjobs',
      ]) {
        if (ids.length) {
          await db
            .collection(name)
            .deleteMany({ userId: { $in: ids } })
            .catch(() => {});
        }
      }
      await User.deleteMany({ githubId: { $in: [USERS.a.id, USERS.b.id] } }).catch(() => {});
    }
    await mongoose.disconnect().catch(() => {});
    await new Promise((resolve) => {
      appServer.closeAllConnections?.();
      appServer.close(() => resolve());
    });
    await new Promise((resolve) => {
      fakeServer.closeAllConnections?.();
      fakeServer.close(() => resolve());
    });
  });

  it('rejects /me without or with a garbage session cookie (no DB needed)', async () => {
    const anon = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(anon.status, 401);
    assert.equal((await anon.json()).error.code, 'UNAUTHENTICATED');

    const garbage = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: 'fd_access=not.a.jwt' },
    });
    assert.equal(garbage.status, 401);
  });

  it('rejects /refresh with a garbage refresh cookie and clears both cookies', async () => {
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: 'fd_refresh=garbage' },
    });
    assert.equal(res.status, 401);
    const setCookies = res.headers.getSetCookie().join('; ');
    assert.ok(setCookies.includes('fd_access=;'), 'must clear fd_access');
    assert.ok(setCookies.includes('fd_refresh=;'), 'must clear fd_refresh');
  });

  it('responds /me with the user record and connection status', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB');
      return;
    }
    fake.user = USERS.a;
    const { access } = await login();
    const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `fd_access=${access}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.login, 'user-a');
    assert.equal(body.user.githubId, USERS.a.id);
    assert.equal(body.user.avatarUrl, USERS.a.avatar);
    assert.equal(body.user.profileUrl, USERS.a.url);
    assert.deepEqual(body.user.scopes, ['read:user', 'repo']);
    assert.equal(body.connected, true);
    assert.equal(body.lastSyncedAt, null);
    assert.ok(
      !JSON.stringify(body).includes(FAKE_ACCESS_TOKEN),
      'token material must never leave the server'
    );
  });

  it('keeps two users isolated: each session sees only its own record', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB');
      return;
    }
    fake.user = USERS.a;
    const a = await login();
    fake.user = USERS.b;
    const b = await login();

    const meB = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `fd_access=${b.access}` } });
    assert.equal((await meB.json()).user.login, 'user-b');

    const meA = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `fd_access=${a.access}` } });
    assert.equal((await meA.json()).user.login, 'user-a', 'A must still see A after B logs in');

    // B cannot rotate A's session: B's refresh token carries B's session id.
    const crossRefresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `fd_refresh=${a.refresh}; fd_access=${b.access}` },
    });
    // A's refresh used with B's githubId? No: A's refresh verifies as sub=4242
    // and matches A's persisted session — rotation succeeds for A, B untouched.
    assert.equal(crossRefresh.status, 200, 'a refresh cookie is always scoped to its own user');
  });

  it('rotates on /refresh; a replayed refresh token kills the whole session', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB');
      return;
    }
    fake.user = USERS.a;
    const { access, refresh } = await login();

    // JWT iat has 1-second resolution: a rotation in the same second as the
    // login reissues a byte-identical token (same sid + same iat). Wait past
    // the second boundary so the assertion below can meaningfully require a
    // different token (T8 DB-gated run found this flake against a fast DB).
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const rotated = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `fd_refresh=${refresh}` },
    });
    assert.equal(rotated.status, 200);
    assert.deepEqual(await rotated.json(), { ok: true });
    const newAccess = cookieValue(rotated, 'fd_access');
    const newRefresh = cookieValue(rotated, 'fd_refresh');
    assert.ok(newAccess && newRefresh, 'rotation must reissue both cookies');
    assert.notEqual(newRefresh, refresh, 'the refresh token must change on rotation');

    // The old access token is still inside its 15-minute window + same session.
    const meAfter = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `fd_access=${access}` } });
    assert.equal(meAfter.status, 200);

    // Replaying the already-rotated refresh token = session theft signal.
    const replay = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `fd_refresh=${refresh}` },
    });
    assert.equal(replay.status, 401, 'replayed refresh token must be rejected');

    // The whole session is now dead — even the freshly rotated access token.
    const deadMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `fd_access=${newAccess}` } });
    assert.equal(deadMe.status, 401, 'reuse detection must invalidate the session');
  });

  it('ends the session on /logout', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB');
      return;
    }
    fake.user = USERS.a;
    const { access } = await login();
    const res = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `fd_access=${access}` },
    });
    assert.equal(res.status, 204);
    const setCookies = res.headers.getSetCookie().join('; ');
    assert.ok(setCookies.includes('fd_access=;'), 'logout must clear fd_access');
    assert.ok(setCookies.includes('fd_refresh=;'), 'logout must clear fd_refresh');

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `fd_access=${access}` } });
    assert.equal(me.status, 401, 'a logged-out access token must stop working immediately');
  });

  it('disconnects: revokes the grant, clears the stored token, ends the session', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB');
      return;
    }
    fake.user = USERS.a;
    const { access } = await login();
    const revocationsBefore = fake.revocations.length;

    const res = await fetch(`${baseUrl}/api/auth/disconnect`, {
      method: 'POST',
      headers: { Cookie: `fd_access=${access}` },
    });
    assert.equal(res.status, 204);

    assert.equal(fake.revocations.length, revocationsBefore + 1, 'the GitHub grant must be revoked');
    assert.equal(fake.revocations[revocationsBefore].auth, `Bearer ${FAKE_ACCESS_TOKEN}`);

    const User = require('../src/models/User');
    const doc = await User.findOne({ githubId: USERS.a.id }).select('+githubTokenEnc').lean();
    assert.equal(doc.githubTokenEnc, null, 'the stored token must be cleared');
    assert.equal(doc.sessionId, null, 'the session must be invalidated');

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `fd_access=${access}` } });
    assert.equal(me.status, 401, 'the session must be over after disconnect');
  });

  it('wipes all user data on /data and returns the accurate delete counts', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB');
      return;
    }
    fake.user = USERS.a;
    const { access } = await login();

    const User = require('../src/models/User');
    const userDoc = await User.findOne({ githubId: USERS.a.id }).lean();
    const db = require('mongoose').connection.db;
    await db.collection('repositories').insertMany([
      { userId: userDoc._id, githubId: 90001, fullName: 'a/repo-1', createdAt: new Date() },
      { userId: userDoc._id, githubId: 90002, fullName: 'a/repo-2', createdAt: new Date() },
    ]);
    await db.collection('commits').insertMany([
      { userId: userDoc._id, sha: 'c1', createdAt: new Date() },
      { userId: userDoc._id, sha: 'c2', createdAt: new Date() },
      { userId: userDoc._id, sha: 'c3', createdAt: new Date() },
    ]);
    // Another user's data must survive the wipe.
    const { encryptToken } = require('../src/services/auth/crypto.service');
    await User.upsertOne({
      githubId: USERS.b.id,
      login: 'user-b',
      avatarUrl: USERS.b.avatar,
      profileUrl: USERS.b.url,
      token: encryptToken(FAKE_ACCESS_TOKEN),
      scopes: ['read:user', 'repo'],
    });
    const otherDoc = await User.findOne({ githubId: USERS.b.id }).lean();
    await db
      .collection('repositories')
      .insertOne({ userId: otherDoc._id, fullName: 'b/repo', createdAt: new Date() });

    const res = await fetch(`${baseUrl}/api/auth/data`, {
      method: 'DELETE',
      headers: { Cookie: `fd_access=${access}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.deleted.repositories, 2);
    assert.equal(body.deleted.commits, 3);
    assert.equal(body.deleted.users, 1);

    assert.equal(await db.collection('repositories').countDocuments({ userId: userDoc._id }), 0);
    assert.equal(await db.collection('commits').countDocuments({ userId: userDoc._id }), 0);
    assert.equal(
      await db.collection('repositories').countDocuments({ userId: otherDoc._id }),
      1,
      "other users' data must survive"
    );
    assert.equal(await User.countDocuments({ githubId: USERS.a.id }), 0, 'the user document must be wiped');

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `fd_access=${access}` } });
    assert.equal(me.status, 401, 'the session must be over after the data wipe');
  });
});
