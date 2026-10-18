/**
 * T7.2 single-flight protection tests (task §8, acceptance C).
 *
 * The production lock is MongoDB's SyncJob partial unique index, reused via
 * `sync.service.claimActive` (kind 'incremental'). No in-memory lock is the
 * correctness mechanism. These tests prove:
 * - manual running -> webhook arrives: no competing sync
 * - webhook running -> manual requested: 409 SYNC_CONFLICT
 * - two webhook events concurrently: exactly one wins
 * - duplicate event + active sync: no competing sync
 * - different repositories of different users sync independently
 * (per-user single-flight is the documented existing semantics — two repos of
 * the SAME user serialize on the same active job, never a global lock.)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { triggerIncrementalIngest } = require('../src/services/ingestion/incremental.trigger');
const { startSync } = require('../src/services/sync/sync.service');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createFakePersist } = require('./test-helpers/fakeSyncPersist');

const silentLog = { info() {}, warn() {}, error() {} };
const BOUNDARY = new Date('2024-01-02T00:00:00.000Z');

function makeFakeRepoModel(rows) {
  const chain = (result) => ({
    select() {
      return chain(result);
    },
    lean() {
      return chain(result);
    },
    exec: async () => result,
  });
  return {
    find(query) {
      return chain(rows.filter((r) => r.githubId === query.githubId).map((r) => ({ ...r })));
    },
  };
}

function makeFetchers() {
  function run(resource, itemKey, userDoc, repos) {
    const out = { [itemKey]: [], cursors: new Map(), capReached: false, errors: new Map() };
    for (const repo of repos) {
      out[itemKey].push({ repoId: repo.repoId, i: 0 });
      out.cursors.set(`${repo.owner}/${repo.name}`, { page: 2 });
    }
    return out;
  }
  return {
    async fetchRepositories() {
      return { repos: [], cursor: null, capReached: false, notModified: false };
    },
    fetchCommits: (u, repos) => run('commits', 'commits', u, repos),
    fetchPulls: (u, repos) => run('pulls', 'prs', u, repos),
    fetchIssues: (u, repos) => run('issues', 'issues', u, repos),
    fetchLanguages: (u, repos) => run('languages', 'languageSnapshots', u, repos),
  };
}

function row(userId, githubId, name) {
  return { userId, owner: 'o', name, githubId, githubUpdatedAt: BOUNDARY, lastSyncedAt: BOUNDARY };
}

function makeCtx(repoRows) {
  const store = createFakeStore();
  const launched = [];
  return {
    store,
    launched,
    deps: {
      repoModel: makeFakeRepoModel(repoRows),
      store,
      loadUser: async () => ({ githubTokenEnc: 'marker', login: 'tester' }),
      launch: (promise, meta) => {
        launched.push({ promise, meta });
      },
      fetchers: makeFetchers(),
      persist: createFakePersist(),
      timeoutMs: 60000,
      log: silentLog,
    },
  };
}

function event(githubId, name = 'r1', updatedAt = '2024-01-03T00:00:00.000Z', deliveryId = 'evt-1') {
  return {
    event: 'push',
    deliveryId,
    repository: { id: githubId, full_name: `o/${name}`, updated_at: updatedAt },
    payload: { repository: { id: githubId, full_name: `o/${name}`, updated_at: updatedAt } },
    receivedAt: Date.now(),
    log: silentLog,
  };
}

function syncDeps(ctx, launched) {
  return {
    store: ctx.store,
    fetchers: ctx.deps.fetchers,
    persist: ctx.deps.persist,
    loadUser: ctx.deps.loadUser,
    launch: (promise, meta) => {
      launched.push({ promise, meta });
    },
    timeoutMs: 60000,
    log: silentLog,
  };
}

describe('T7.2 single-flight (C)', () => {
  it('manual sync running -> webhook arrives: conflict, no competing sync', async () => {
    const ctx = makeCtx([row('user-a', 11, 'r1')]);
    const manualLaunches = [];
    const manual = await startSync('user-a', { ...syncDeps(ctx, manualLaunches), kind: 'resync' });
    assert.ok(manual.jobId);
    const outcome = await triggerIncrementalIngest(event(11, 'r1'), ctx.deps);
    assert.deepEqual(outcome.outcomes, [{ result: 'conflict', jobId: manual.jobId }]);
    assert.equal(ctx.launched.length, 0, 'webhook must not start a competing sync');
    assert.equal(await ctx.store.countJobs('user-a'), 1, 'no second job may exist');
    await manualLaunches[0].promise;
  });

  it('webhook sync running -> manual sync requested: 409 SYNC_CONFLICT', async () => {
    const ctx = makeCtx([row('user-a', 11, 'r1')]);
    const outcome = await triggerIncrementalIngest(event(11, 'r1'), ctx.deps);
    assert.equal(outcome.outcomes[0].result, 'queued');
    const manualLaunches = [];
    await assert.rejects(
      startSync('user-a', { ...syncDeps(ctx, manualLaunches), kind: 'resync' }),
      (err) => err.code === 'SYNC_CONFLICT'
    );
    assert.equal(await ctx.store.countJobs('user-a'), 1);
    await ctx.launched[0].promise;
  });

  it('two webhook events concurrently for the same user/repo: exactly one wins', async () => {
    const ctx = makeCtx([row('user-a', 11, 'r1')]);
    const [a, b] = await Promise.all([
      triggerIncrementalIngest(event(11, 'r1', '2024-01-03T00:00:00.000Z', 'evt-a'), ctx.deps),
      triggerIncrementalIngest(event(11, 'r1', '2024-01-03T00:00:00.000Z', 'evt-b'), ctx.deps),
    ]);
    const results = [a, b].map((r) => r.outcomes[0].result).sort();
    assert.deepEqual(results, ['conflict', 'queued']);
    assert.equal(ctx.launched.length, 1, 'only one sync proceeds');
    assert.equal(await ctx.store.countJobs('user-a'), 1);
    await ctx.launched[0].promise;
  });

  it('duplicate event while a sync is active: no competing sync starts', async () => {
    const ctx = makeCtx([row('user-a', 11, 'r1')]);
    const first = await triggerIncrementalIngest(
      event(11, 'r1', '2024-01-03T00:00:00.000Z', 'evt-dup-1'),
      ctx.deps
    );
    assert.equal(first.outcomes[0].result, 'queued');
    // Second delivery for the same repo while the run is still active:
    const second = await triggerIncrementalIngest(
      event(11, 'r1', '2024-01-03T00:00:00.000Z', 'evt-dup-2'),
      ctx.deps
    );
    assert.equal(second.outcomes[0].result, 'conflict');
    assert.equal(ctx.launched.length, 1);
    assert.equal(await ctx.store.countJobs('user-a'), 1);
  });

  it('different repositories of different users sync independently (no global lock)', async () => {
    const ctx = makeCtx([row('user-a', 11, 'r1'), row('user-b', 22, 'r2')]);
    const [a, b] = await Promise.all([
      triggerIncrementalIngest(event(11, 'r1', '2024-01-03T00:00:00.000Z', 'evt-u1'), ctx.deps),
      triggerIncrementalIngest(event(22, 'r2', '2024-01-03T00:00:00.000Z', 'evt-u2'), ctx.deps),
    ]);
    assert.equal(a.outcomes[0].result, 'queued');
    assert.equal(b.outcomes[0].result, 'queued');
    const userIds = ctx.launched.map((l) => l.meta.userId).sort();
    assert.deepEqual(userIds, ['user-a', 'user-b']);
    assert.equal(await ctx.store.countJobs('user-a'), 1);
    assert.equal(await ctx.store.countJobs('user-b'), 1);
    await Promise.all(ctx.launched.map((l) => l.promise));
  });

  it('reuses the DB-enforced claim (partial unique index), not an in-memory lock', async () => {
    // The fake store mirrors the index: a second createJob for the same user
    // while active rejects with E11000, which claimActive maps to SYNC_CONFLICT.
    const ctx = makeCtx([row('user-a', 11, 'r1')]);
    const job = await ctx.store.createJob({ userId: 'user-a', kind: 'resync' });
    const outcome = await triggerIncrementalIngest(event(11, 'r1'), ctx.deps);
    assert.equal(outcome.outcomes[0].result, 'conflict');
    assert.equal(outcome.outcomes[0].jobId, job.id);
  });

  it('does NOT misreport a store failure during claim as a conflict (store-error)', async () => {
    const store = createFakeStore({ failMethods: ['findActiveJob'] });
    const launched = [];
    const ctx = {
      deps: {
        repoModel: makeFakeRepoModel([row('user-a', 11, 'r1')]),
        store,
        loadUser: async () => ({ githubTokenEnc: 'marker', login: 'tester' }),
        launch: (promise, meta) => {
          launched.push({ promise, meta });
        },
        fetchers: makeFetchers(),
        persist: createFakePersist(),
        timeoutMs: 60000,
        log: silentLog,
      },
    };
    const outcome = await triggerIncrementalIngest(event(11, 'r1'), ctx.deps);
    assert.equal(outcome.outcomes[0].result, 'store-error', 'a store failure must not be a conflict');
    assert.equal(outcome.outcomes[0].jobId, undefined);
    assert.equal(launched.length, 0, 'no sync may start on a failed claim');
    assert.equal(await store.countJobs('user-a'), 0, 'no job may be created');
  });

  it('logs the claim store failure safely (no raw driver message)', async () => {
    const errors = [];
    const store = createFakeStore({ failMethods: ['findActiveJob'] });
    const ctx = {
      deps: {
        repoModel: makeFakeRepoModel([row('user-a', 11, 'r1')]),
        store,
        loadUser: async () => ({ githubTokenEnc: 'marker', login: 'tester' }),
        launch: () => {},
        fetchers: makeFetchers(),
        persist: createFakePersist(),
        timeoutMs: 60000,
        log: { info() {}, warn() {}, error: (entry) => errors.push(entry) },
      },
    };
    await triggerIncrementalIngest(event(11, 'r1'), ctx.deps);
    assert.equal(errors.length, 1);
    const entry = errors[0];
    assert.equal(entry.result, 'store-error');
    assert.equal(entry.code, 'INTERNAL');
    assert.equal(entry.operation, 'claim');
    assert.equal('message' in entry, false, 'raw driver message must not be logged');
    assert.equal('err' in entry, false, 'raw error object must not be logged');
  });

  it('logs a loadUser failure safely without the raw driver message', async () => {
    const errors = [];
    const ctx = {
      deps: {
        repoModel: makeFakeRepoModel([row('user-a', 11, 'r1')]),
        store: createFakeStore(),
        loadUser: async () => {
          throw new Error('connect ECONNREFUSED mongodb://user:secret@127.0.0.1:27017');
        },
        launch: () => {},
        fetchers: makeFetchers(),
        persist: createFakePersist(),
        timeoutMs: 60000,
        log: { info() {}, warn() {}, error: (entry) => errors.push(entry) },
      },
    };
    const outcome = await triggerIncrementalIngest(event(11, 'r1'), ctx.deps);
    assert.equal(outcome.outcomes[0].result, 'store-error');
    assert.equal(errors.length, 1);
    const entry = errors[0];
    assert.equal(entry.code, 'INTERNAL');
    assert.equal(entry.operation, 'load-user');
    assert.equal('message' in entry, false, 'raw driver message must not be logged');
    assert.equal('err' in entry, false, 'raw error object must not be logged');
  });
});
