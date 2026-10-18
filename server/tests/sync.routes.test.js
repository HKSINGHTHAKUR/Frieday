/**
 * Sync HTTP route tests (T2.3) — real Express stack over HTTP.
 *
 * Two router configurations:
 * - default (real requireAuth): proves auth enforcement without a database
 *   (missing/garbage cookies are rejected before any DB access).
 * - injected fake auth + fake store/fetchers: proves the full authenticated
 *   contract (202/409/status shapes/cross-user/leakage) with real HTTP
 *   concurrency through the real claim flow.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { createApp } = require('../src/app');
const { createSyncRouter } = require('../src/routes/sync.routes');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createScriptedFetchers, deferred } = require('./test-helpers/fakeSyncFetchers');
const { createFakePersist } = require('./test-helpers/fakeSyncPersist');

const ROSTER = [{ owner: 'o1', name: 'r1', githubId: 11 }];
const MARKER = 'enc-MARKER-SECRET-xyz';

function silentLog() {
  return { info() {}, warn() {}, error() {} };
}

function fakeAuth(userId) {
  return (req, _res, next) => {
    req.user = { id: userId, githubId: 42, login: 'tester' };
    next();
  };
}

function mountTestRouter({ authMiddleware, deps }) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.log = silentLog();
    next();
  });
  app.use('/api/sync', createSyncRouter({ authMiddleware, deps }));
  const server = app.listen(0);
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function serviceDeps(store, overrides = {}) {
  const launched = [];
  return {
    store,
    fetchers: createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: [] }),
    persist: createFakePersist(),
    loadUser: async () => ({ githubTokenEnc: MARKER }),
    launch: (promise, ctx) => {
      launched.push({ promise, ctx });
    },
    timeoutMs: 60000,
    log: silentLog(),
    launched,
    ...overrides,
  };
}

describe('sync routes (T2.3)', () => {
  describe('auth enforcement (real middleware, no database needed)', () => {
    let server;
    let baseUrl;

    before(async () => {
      const app = createApp();
      server = app.listen(0);
      await new Promise((resolve) => server.on('listening', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
      await closeServer(server);
    });

    it('rejects POST /api/sync without a session (401, envelope)', async () => {
      const res = await fetch(`${baseUrl}/api/sync`, { method: 'POST' });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, 'UNAUTHENTICATED');
      assert.equal(body.error.retryable, false);
    });

    it('rejects GET /api/sync/status without a session (401, envelope)', async () => {
      const res = await fetch(`${baseUrl}/api/sync/status`);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    });

    it('rejects a garbage session cookie (401)', async () => {
      const res = await fetch(`${baseUrl}/api/sync/status`, { headers: { cookie: 'fd_access=garbage' } });
      assert.equal(res.status, 401);
    });
  });

  describe('authenticated contract (injected auth + store)', () => {
    it('rejects an invalid kind with 400 VALIDATION_ERROR', async () => {
      const store = createFakeStore();
      const { server, baseUrl } = mountTestRouter({
        authMiddleware: fakeAuth('user-1'),
        deps: serviceDeps(store),
      });
      try {
        const res = await fetch(`${baseUrl}/api/sync`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'bogus' }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, 'VALIDATION_ERROR');
        assert.equal(body.error.retryable, false);
      } finally {
        await closeServer(server);
      }
    });

    it('starts a sync with 202 and reports it as succeeded after the run', async () => {
      const store = createFakeStore();
      const deps = serviceDeps(store);
      const { server, baseUrl } = mountTestRouter({ authMiddleware: fakeAuth('user-1'), deps });
      try {
        const started = await fetch(`${baseUrl}/api/sync`, { method: 'POST' });
        assert.equal(started.status, 202);
        const startedBody = await started.json();
        assert.ok(startedBody.jobId);
        assert.equal(startedBody.status, 'running');
        assert.ok(!JSON.stringify(startedBody).includes('MARKER'), 'responses must never carry the token');
        await Promise.all(deps.launched.map((l) => l.promise));
        const status = await fetch(`${baseUrl}/api/sync/status`);
        assert.equal(status.status, 200);
        const payload = await status.json();
        assert.equal(payload.status, 'succeeded');
        assert.equal(payload.jobId, startedBody.jobId);
        assert.deepEqual(payload.counts, { repositories: 1, commits: 2, pulls: 2, issues: 2, languages: 2 });
        assert.ok(!JSON.stringify(payload).includes('MARKER'));
      } finally {
        await closeServer(server);
      }
    });

    it('returns 409 with current status on concurrent starts (real HTTP race)', async () => {
      const store = createFakeStore();
      const gate = deferred();
      const deps = serviceDeps(store, {
        fetchers: createScriptedFetchers({
          repos: ROSTER,
          behaviors: { repositories: { defer: gate } },
          log: [],
        }),
      });
      const { server, baseUrl } = mountTestRouter({ authMiddleware: fakeAuth('user-1'), deps });
      try {
        const [first, second] = await Promise.all([
          fetch(`${baseUrl}/api/sync`, { method: 'POST' }),
          fetch(`${baseUrl}/api/sync`, { method: 'POST' }),
        ]);
        const codes = [first.status, second.status].sort();
        assert.deepEqual(codes, [202, 409], 'exactly one concurrent start must win');
        const loser = first.status === 409 ? first : second;
        const loserBody = await loser.json();
        assert.equal(loserBody.error.code, 'SYNC_CONFLICT');
        assert.equal(loserBody.error.retryable, false);
        assert.ok(loserBody.error.details.jobId, 'the conflict carries the live job');
        assert.ok(!JSON.stringify(loserBody).includes('MARKER'));
        gate.resolve();
        await Promise.all(deps.launched.map((l) => l.promise));
      } finally {
        await closeServer(server);
      }
    });

    it('exposes a live running status, then completion', async () => {
      const store = createFakeStore();
      const gate = deferred();
      const deps = serviceDeps(store, {
        fetchers: createScriptedFetchers({
          repos: ROSTER,
          behaviors: { repositories: { defer: gate } },
          log: [],
        }),
      });
      const { server, baseUrl } = mountTestRouter({ authMiddleware: fakeAuth('user-1'), deps });
      try {
        const started = await fetch(`${baseUrl}/api/sync`, { method: 'POST' });
        assert.equal(started.status, 202);
        // Give the background run a chance to claim + block on the deferred fetch.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const mid = await fetch(`${baseUrl}/api/sync/status`);
        const midBody = await mid.json();
        assert.equal(midBody.status, 'running');
        assert.equal(midBody.phase, 'repositories');
        gate.resolve();
        await Promise.all(deps.launched.map((l) => l.promise));
        const done = await fetch(`${baseUrl}/api/sync/status`);
        const doneBody = await done.json();
        assert.equal(doneBody.status, 'succeeded');
        assert.equal(doneBody.done, doneBody.total);
        assert.ok(Array.isArray(doneBody.history));
      } finally {
        await closeServer(server);
      }
    });

    it('isolates users over HTTP (cross-user)', async () => {
      const store = createFakeStore();
      const depsA = serviceDeps(store);
      const appA = mountTestRouter({ authMiddleware: fakeAuth('user-a'), deps: depsA });
      const appB = mountTestRouter({ authMiddleware: fakeAuth('user-b'), deps: serviceDeps(store) });
      try {
        const started = await fetch(`${appA.baseUrl}/api/sync`, { method: 'POST' });
        assert.equal(started.status, 202);
        await Promise.all(depsA.launched.map((l) => l.promise));
        const statusB = await fetch(`${appB.baseUrl}/api/sync/status`);
        const bodyB = await statusB.json();
        assert.equal(bodyB.status, 'idle', 'user B must not see user A sync');
        assert.ok(!JSON.stringify(bodyB).includes('user-a'));
        const startB = await fetch(`${appB.baseUrl}/api/sync`, { method: 'POST' });
        assert.equal(startB.status, 202, 'user A activity must not block user B');
      } finally {
        await closeServer(appA.server);
        await closeServer(appB.server);
      }
    });

    it('returns idle cleanly when nothing ever ran', async () => {
      const store = createFakeStore();
      const { server, baseUrl } = mountTestRouter({
        authMiddleware: fakeAuth('user-1'),
        deps: serviceDeps(store),
      });
      try {
        const res = await fetch(`${baseUrl}/api/sync/status`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'idle');
        assert.equal(body.jobId, null);
        assert.deepEqual(body.perResource, {});
      } finally {
        await closeServer(server);
      }
    });

    it('hides driver details behind a generic 503 message', async () => {
      const store = createFakeStore({ failMethods: ['getLatestJob', 'getStates', 'listHistory'] });
      const { server, baseUrl } = mountTestRouter({
        authMiddleware: fakeAuth('user-1'),
        deps: serviceDeps(store),
      });
      try {
        const res = await fetch(`${baseUrl}/api/sync/status`);
        assert.equal(res.status, 500);
        const body = await res.json();
        assert.equal(body.error.code, 'INTERNAL');
        assert.equal(body.error.message, 'Something went wrong.');
        assert.ok(!JSON.stringify(body).includes('fake store failure'), 'no internals may leak');
      } finally {
        await closeServer(server);
      }
    });
  });
});
