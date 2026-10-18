/**
 * Sync service tests (T2.3) — claim/single-flight, stale reap, prune,
 * validation, status shaping, cross-user isolation, all against the
 * in-memory fake store (no MongoDB).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { startSync, getStatus, buildStatusPayload } = require('../src/services/sync/sync.service');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createScriptedFetchers } = require('./test-helpers/fakeSyncFetchers');
const { createFakePersist } = require('./test-helpers/fakeSyncPersist');

const USER_A = 'user-a';
const USER_B = 'user-b';
const USER_DOC = { githubTokenEnc: 'enc-test-marker' };
const ROSTER = [{ owner: 'o1', name: 'r1', githubId: 11 }];

const silentLog = { info() {}, warn() {}, error() {} };

function serviceDeps(store, overrides = {}) {
  const launched = [];
  return {
    store,
    fetchers: createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: [] }),
    persist: createFakePersist(),
    loadUser: async () => ({ ...USER_DOC }),
    launch: (promise, ctx) => {
      launched.push({ promise, ctx });
    },
    timeoutMs: 60000,
    log: silentLog,
    launched,
    ...overrides,
  };
}

describe('sync.service (T2.3)', () => {
  describe('startSync validation', () => {
    it('rejects unknown kinds without touching the store', async () => {
      const store = createFakeStore();
      const deps = serviceDeps(store);
      await assert.rejects(
        startSync(USER_A, { ...deps, kind: 'bogus' }),
        (err) => err.code === 'VALIDATION_ERROR'
      );
      await assert.rejects(
        startSync(USER_A, { ...deps, kind: 'bogus2' }),
        (err) => err.code === 'VALIDATION_ERROR'
      );
      assert.equal(await store.countJobs(USER_A), 0, 'no job may be created for invalid input');
    });

    it('defaults kind to initial and accepts resync', async () => {
      const store = createFakeStore();
      const depsA = serviceDeps(store);
      const out = await startSync(USER_A, depsA);
      assert.equal(out.kind, 'initial');
      const depsB = serviceDeps(store, { kind: 'resync' });
      const out2 = await startSync(USER_B, depsB);
      assert.equal(out2.kind, 'resync');
      await Promise.all(depsA.launched.concat(depsB.launched).map((l) => l.promise));
    });

    it('accepts kind incremental (T7.2 scheduler/automatic path)', async () => {
      const store = createFakeStore();
      const deps = serviceDeps(store, { kind: 'incremental' });
      const out = await startSync(USER_A, deps);
      assert.equal(out.kind, 'incremental');
      await deps.launched[0].promise;
    });

    it('rejects a missing user without touching the store', async () => {
      const store = createFakeStore();
      await assert.rejects(startSync(null, serviceDeps(store)), (err) => err.code === 'INTERNAL');
    });

    it('requires a connected GitHub account', async () => {
      const store = createFakeStore();
      const noToken = serviceDeps(store, { loadUser: async () => ({ githubTokenEnc: null }) });
      await assert.rejects(startSync(USER_A, noToken), (err) => err.code === 'UNAUTHENTICATED');
      const noUser = serviceDeps(store, { loadUser: async () => null });
      await assert.rejects(startSync(USER_A, noUser), (err) => err.code === 'UNAUTHENTICATED');
      assert.equal(await store.countJobs(USER_A), 0);
    });

    it('maps a dead user lookup to typed INTERNAL (no driver details)', async () => {
      const store = createFakeStore();
      const dead = serviceDeps(store, {
        loadUser: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:27017');
        },
      });
      await assert.rejects(
        startSync(USER_A, dead),
        (err) => err.code === 'INTERNAL' && err.retryable === true
      );
    });
  });

  describe('single-flight claim', () => {
    it('starts a job and launches the run in the background', async () => {
      const store = createFakeStore();
      const deps = serviceDeps(store);
      const out = await startSync(USER_A, deps);
      assert.equal(out.status, 'running');
      assert.ok(out.jobId);
      assert.ok(out.startedAt instanceof Date);
      assert.equal(deps.launched.length, 1);
      assert.equal(deps.launched[0].ctx.jobId, out.jobId);
      assert.equal(deps.launched[0].ctx.userId, USER_A);
      await deps.launched[0].promise;
      const finished = await store.getLatestJob(USER_A);
      assert.equal(finished.status, 'succeeded');
    });

    it('rejects a second concurrent start with 409 + current status', async () => {
      const store = createFakeStore();
      const deps = serviceDeps(store);
      const first = await startSync(USER_A, deps);
      await assert.rejects(startSync(USER_A, serviceDeps(store)), (err) => {
        assert.equal(err.code, 'SYNC_CONFLICT');
        assert.equal(err.status, 409);
        assert.equal(err.retryable, false);
        assert.equal(err.details.jobId, first.jobId);
        assert.equal(err.details.status, 'running');
        return true;
      });
      assert.equal(await store.countJobs(USER_A), 1, 'the loser must not create a job');
      await deps.launched[0].promise;
    });

    it('lets two simultaneous starts race safely: exactly one wins', async () => {
      const store = createFakeStore();
      const depsA = serviceDeps(store);
      const depsB = serviceDeps(store);
      const results = await Promise.allSettled([startSync(USER_A, depsA), startSync(USER_A, depsB)]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      assert.equal(won.length, 1);
      assert.equal(lost.length, 1);
      assert.equal(lost[0].reason.code, 'SYNC_CONFLICT');
      assert.equal(await store.countJobs(USER_A), 1);
      await Promise.all(depsA.launched.concat(depsB.launched).map((l) => l.promise));
      assert.equal((await store.getLatestJob(USER_A)).status, 'succeeded');
    });

    it('reaps a stale active job and lets the new claim proceed', async () => {
      const store = createFakeStore();
      const stale = store.__seedJob({
        userId: USER_A,
        status: 'running',
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
      const deps = serviceDeps(store);
      const out = await startSync(USER_A, deps);
      assert.ok(out.jobId !== stale.id);
      const old = store._jobs.get(stale.id);
      assert.equal(old.status, 'failed');
      assert.ok(old.error.includes('interrupted'), 'the reap reason must explain resumption');
      await deps.launched[0].promise;
    });

    it('does not reap a fresh active job', async () => {
      const store = createFakeStore();
      const live = store.__seedJob({ userId: USER_A, status: 'running', startedAt: new Date() });
      await assert.rejects(startSync(USER_A, serviceDeps(store)), (err) => err.code === 'SYNC_CONFLICT');
      assert.equal(store._jobs.get(live.id).status, 'running', 'a live job must never be reaped');
    });

    it('maps a phantom duplicate-key to 409 instead of crashing', async () => {
      const store = createFakeStore();
      store.createJob = async () => {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      };
      await assert.rejects(startSync(USER_A, serviceDeps(store)), (err) => err.code === 'SYNC_CONFLICT');
    });

    it('prunes history beyond the cap without stranding the new job', async () => {
      const store = createFakeStore();
      for (let i = 0; i < 21; i++) {
        store.__seedJob({ userId: USER_A, status: 'succeeded', finishedAt: new Date() });
      }
      const deps = serviceDeps(store);
      const out = await startSync(USER_A, deps);
      await deps.launched[0].promise;
      assert.equal(await store.countJobs(USER_A), 20, 'history stays capped');
      assert.ok(store._jobs.has(out.jobId), 'the new job itself must survive pruning');
    });
  });

  describe('getStatus', () => {
    it('returns a clean idle payload with no jobs', async () => {
      const store = createFakeStore();
      const payload = await getStatus(USER_A, { store });
      assert.equal(payload.status, 'idle');
      assert.equal(payload.jobId, null);
      assert.equal(payload.done, 0);
      assert.equal(payload.total, 0);
      assert.deepEqual(payload.perResource, {});
      assert.equal(payload.error, null);
      assert.deepEqual(payload.history, []);
    });

    it('keeps resource states visible on idle (last-synced display)', async () => {
      const store = createFakeStore();
      await store.saveState(USER_A, 'repositories', {
        status: 'done',
        lastSyncedAt: new Date('2024-01-01T00:00:00Z'),
      });
      const payload = await getStatus(USER_A, { store });
      assert.equal(payload.status, 'idle');
      assert.equal(payload.resources.repositories.status, 'done');
    });

    it('exposes a running job with live progress', async () => {
      const store = createFakeStore();
      const job = store.__seedJob({
        userId: USER_A,
        status: 'running',
        progress: { phase: 'commits', done: 3, total: 9 },
        perResource: { repositories: 'done' },
        counts: { repositories: 2 },
      });
      const payload = await getStatus(USER_A, { store });
      assert.equal(payload.status, 'running');
      assert.equal(payload.jobId, job.id);
      assert.equal(payload.phase, 'commits');
      assert.equal(payload.done, 3);
      assert.equal(payload.total, 9);
      assert.deepEqual(payload.perResource, { repositories: 'done' });
      assert.deepEqual(payload.counts, { repositories: 2 });
      assert.equal(payload.error, null);
    });

    it('exposes terminal failure with safe error info and resume time', async () => {
      const store = createFakeStore();
      const resumeAt = new Date(Date.now() + 3600000);
      store.__seedJob({
        userId: USER_A,
        status: 'failed',
        progress: { phase: 'commits', done: 2, total: 9 },
        perResource: { repositories: 'done', commits: 'rate_limited' },
        counts: { repositories: 2, commits: 2 },
        error: 'GitHub rate limit reached.',
        errorCode: 'RATE_LIMITED',
        resumeAt,
        finishedAt: new Date(),
      });
      const payload = await getStatus(USER_A, { store });
      assert.equal(payload.status, 'failed');
      assert.deepEqual(payload.error, { code: 'RATE_LIMITED', message: 'GitHub rate limit reached.' });
      assert.equal(payload.resumeAt.getTime(), resumeAt.getTime());
    });

    it('lists job history newest-first', async () => {
      const store = createFakeStore();
      store.__seedJob({ userId: USER_A, status: 'succeeded', kind: 'initial' });
      store.__seedJob({ userId: USER_A, status: 'failed', kind: 'resync', error: 'x' });
      const payload = await getStatus(USER_A, { store });
      assert.equal(payload.history.length, 2);
      assert.equal(payload.history[0].kind, 'resync');
      assert.equal(payload.history[1].kind, 'initial');
    });

    it('never leaks another user jobs or states (cross-user isolation)', async () => {
      const store = createFakeStore();
      const other = store.__seedJob({ userId: USER_B, status: 'failed', error: 'secret-failure' });
      await store.saveState(USER_B, 'commits', { status: 'failed', error: 'secret' });
      const payload = await getStatus(USER_A, { store });
      assert.equal(payload.status, 'idle');
      assert.ok(!JSON.stringify(payload).includes(other.id), 'user B job id must not appear');
      assert.ok(!JSON.stringify(payload).includes('secret'), 'user B data must not appear');
      assert.deepEqual(payload.resources, {});
    });

    it('scopes concurrent users independently end to end', async () => {
      const store = createFakeStore();
      const depsA = serviceDeps(store);
      const depsB = serviceDeps(store);
      const [outA, outB] = await Promise.all([startSync(USER_A, depsA), startSync(USER_B, depsB)]);
      assert.ok(outA.jobId !== outB.jobId);
      await Promise.all(depsA.launched.concat(depsB.launched).map((l) => l.promise));
      assert.equal((await getStatus(USER_A, { store })).status, 'succeeded');
      assert.equal((await getStatus(USER_B, { store })).status, 'succeeded');
    });
  });

  describe('buildStatusPayload', () => {
    it('shapes a full payload from job + states + history', () => {
      const now = new Date();
      const payload = buildStatusPayload({
        job: {
          id: 'job-1',
          kind: 'initial',
          status: 'running',
          progress: { phase: 'pulls', done: 5, total: 9 },
          perResource: { repositories: 'done', commits: 'done' },
          counts: { repositories: 2, commits: 4 },
          error: null,
          errorCode: null,
          resumeAt: null,
          startedAt: now,
          finishedAt: null,
        },
        states: new Map([['repositories', { status: 'done', lastSyncedAt: now, error: null }]]),
        history: [],
      });
      assert.equal(payload.status, 'running');
      assert.equal(payload.phase, 'pulls');
      assert.equal(payload.done, 5);
      assert.equal(payload.resources.repositories.status, 'done');
    });

    it('tolerates a job without progress', () => {
      const payload = buildStatusPayload({
        job: { id: 'j', kind: 'initial', status: 'queued', progress: null },
        states: new Map(),
        history: [],
      });
      assert.equal(payload.phase, null);
      assert.equal(payload.done, 0);
    });
  });
});
