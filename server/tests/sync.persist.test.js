/**
 * Orchestrator × persistence wiring tests (T3.2).
 *
 * The real T2.2 fetchers are replaced by scripted fakes and the real
 * persistence namespace by a recording fake: these tests prove the wiring
 * (what is persisted, when, with what identity context, and how failures
 * flow) while persist.test.js proves the real bulk semantics.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { runSync } = require('../src/services/sync/sync.orchestrator');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createScriptedFetchers } = require('./test-helpers/fakeSyncFetchers');
const { createFakePersist } = require('./test-helpers/fakeSyncPersist');

const USER = 'user-1';
const USER_DOC = { githubTokenEnc: 'enc-test-marker' };
const ROSTER = [
  { owner: 'o1', name: 'r1', githubId: 11 },
  { owner: 'o2', name: 'r2', githubId: 22 },
];

const silentLog = { info() {}, warn() {}, error() {} };

function setup({ behaviors = {}, persistCalls = null, recomputeCalls = null } = {}) {
  const store = createFakeStore();
  const persist = createFakePersist(persistCalls ? { calls: persistCalls } : {});
  const fetchers = createScriptedFetchers({ repos: ROSTER, behaviors, log: [] });
  const recompute = async (userId, context) => {
    if (recomputeCalls) recomputeCalls.push({ userId, context });
    return { accepted: false, reason: 'phase-4-not-implemented' };
  };
  return { store, persist, fetchers, recompute, recomputeCalls };
}

async function claim(store) {
  return store.createJob({ userId: USER, kind: 'initial' });
}

describe('sync persistence wiring (T3.2)', () => {
  it('persists every phase with fetched DTOs and forwards the user login', async () => {
    const persistCalls = [];
    const { store, persist, fetchers } = setup({ persistCalls });
    const job = await claim(store);
    const out = await runSync({
      userId: USER,
      userDoc: USER_DOC,
      userLogin: 'octo',
      jobId: job.id,
      store,
      fetchers,
      persist,
      timeoutMs: 60000,
      log: silentLog,
    });
    assert.equal(out.status, 'succeeded');
    const fetched = persistCalls.filter((c) => c.op === 'persistFetched');
    assert.deepEqual(
      fetched.map((c) => c.resource),
      ['repositories', 'commits', 'pulls', 'issues', 'languages']
    );
    assert.ok(
      fetched.every((c) => c.count > 0),
      'each phase persists its fetched DTOs'
    );
    assert.ok(
      fetched.every((c) => c.userLogin === 'octo'),
      'ownership flags need the login'
    );
    const maps = persistCalls.filter((c) => c.op === 'loadRepoIdMap');
    assert.equal(maps.length, 1, 'the repo map loads once per run');
    assert.equal(maps[0].count, 2);
  });

  it('reports persisted (not fetched) counts when they differ', async () => {
    const { store, fetchers } = setup();
    const persist = createFakePersist({
      persistedPerCall: (resource, dtos) => (resource === 'commits' ? 1 : dtos.length),
    });
    const job = await claim(store);
    const out = await runSync({
      userId: USER,
      userDoc: USER_DOC,
      jobId: job.id,
      store,
      fetchers,
      persist,
      timeoutMs: 60000,
      log: silentLog,
    });
    assert.equal(out.status, 'succeeded');
    assert.equal(out.counts.commits, 1, 'counts reflect persisted records');
    assert.equal(out.counts.pulls, 4);
  });

  it('fails the resource (not the run) on invalid DTOs, and continues', async () => {
    const store = createFakeStore();
    const persistCalls = [];
    const persist = {
      calls: persistCalls,
      async loadRepoIdMap() {
        return new Map();
      },
      async persistFetched(userId, resource, dtos) {
        persistCalls.push({ op: 'persistFetched', resource, count: dtos.length });
        if (resource === 'commits') {
          return {
            persisted: 0,
            invalid: [
              {
                index: 0,
                key: 'commit:?',
                message: 'Missing required identity field: sha.',
                code: 'VALIDATION_ERROR',
              },
            ],
            writeErrors: [],
          };
        }
        return { persisted: dtos.length, invalid: [], writeErrors: [] };
      },
    };
    const fetchers = createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: [] });
    const job = await claim(store);
    const out = await runSync({
      userId: USER,
      userDoc: USER_DOC,
      jobId: job.id,
      store,
      fetchers,
      persist,
      timeoutMs: 60000,
      log: silentLog,
    });
    assert.equal(out.status, 'failed', 'invalid records fail their resource honestly');
    assert.equal(out.perResource.commits, 'failed');
    assert.equal(out.perResource.pulls, 'done', 'later phases still run');
    const states = await store.getStates(USER);
    assert.equal(states.get('commits').status, 'failed');
  });

  it('fails the resource (not the run) when persistence itself throws', async () => {
    const store = createFakeStore();
    const persist = createFakePersist();
    const failing = {
      ...persist,
      async persistFetched(userId, resource, dtos, opts) {
        if (resource === 'pulls') {
          const err = new Error('connection lost');
          throw err;
        }
        return persist.persistFetched(userId, resource, dtos, opts);
      },
    };
    const fetchers = createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: [] });
    const job = await claim(store);
    const out = await runSync({
      userId: USER,
      userDoc: USER_DOC,
      jobId: job.id,
      store,
      fetchers,
      persist: failing,
      timeoutMs: 60000,
      log: silentLog,
    });
    assert.equal(out.status, 'failed');
    assert.equal(out.perResource.pulls, 'failed');
    assert.equal(out.perResource.issues, 'done', 'later phases still run');
  });

  it('triggers recompute after success, skips it when nothing was done', async () => {
    const recomputeCalls = [];
    const first = setup({ recomputeCalls });
    const job = await claim(first.store);
    await runSync({
      userId: USER,
      userDoc: USER_DOC,
      jobId: job.id,
      store: first.store,
      fetchers: first.fetchers,
      persist: createFakePersist(),
      recompute: first.recompute,
      timeoutMs: 60000,
      log: silentLog,
    });
    assert.equal(recomputeCalls.length, 1);
    assert.equal(recomputeCalls[0].userId, USER);
    assert.ok(recomputeCalls[0].context.jobId, 'the hook carries the job identity');
    assert.equal(recomputeCalls[0].context.status, 'succeeded');

    const down = Object.assign(new Error('down'), { code: 'GITHUB_UNREACHABLE' });
    const second = setup({ recomputeCalls: [] });
    const failingFetchers = createScriptedFetchers({
      repos: [],
      behaviors: { repositories: { throw: down } },
      log: [],
    });
    const job2 = await claim(second.store);
    await runSync({
      userId: USER,
      userDoc: USER_DOC,
      jobId: job2.id,
      store: second.store,
      fetchers: failingFetchers,
      persist: createFakePersist(),
      recompute: second.recompute,
      timeoutMs: 60000,
      log: silentLog,
    });
    assert.equal(second.recomputeCalls.length, 0, 'no fresh data means no recompute trigger');
  });

  it('still succeeds when the recompute hook itself throws', async () => {
    const { store, fetchers } = setup();
    const job = await claim(store);
    const out = await runSync({
      userId: USER,
      userDoc: USER_DOC,
      jobId: job.id,
      store,
      fetchers,
      persist: createFakePersist(),
      recompute: async () => {
        throw new Error('hook exploded');
      },
      timeoutMs: 60000,
      log: silentLog,
    });
    assert.equal(out.status, 'succeeded', 'a hook failure must never fail a persisted sync');
  });
});
