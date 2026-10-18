/**
 * Sync resume / timeout / idempotency tests (T2.3).
 *
 * Crash recovery is represented by its persisted remnants (partial SyncState
 * checkpoints + a failed or stale-running job) — exactly what a real crash
 * leaves behind. Resume must skip finished work, retry the rest from stored
 * cursors, and never duplicate persisted records.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { runSync } = require('../src/services/sync/sync.orchestrator');
const { getStatus } = require('../src/services/sync/sync.service');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createScriptedFetchers } = require('./test-helpers/fakeSyncFetchers');
const { createFakePersist } = require('./test-helpers/fakeSyncPersist');

const USER = 'user-1';
const USER_DOC = { githubTokenEnc: 'enc-test-marker' };
const ROSTER = [
  { owner: 'o1', name: 'r1', githubId: 11 },
  { owner: 'o2', name: 'r2', githubId: 22 },
  { owner: 'o3', name: 'r3', githubId: 33 },
];

function rateError() {
  return {
    message: 'GitHub API rate limit reached. Retry after the resume time.',
    code: 'RATE_LIMITED',
    retryable: true,
    resumeAt: new Date(Date.now() + 3600000),
  };
}

describe('sync resume/timeout/idempotency (T2.3)', () => {
  describe('rate-limit pause and resume', () => {
    it('aborts with RATE_LIMITED + resumeAt, keeps checkpoints, then resumes cleanly', async () => {
      const store = createFakeStore();
      const log = [];
      // Run 1: repo o1/r1 commits succeed (checkpointed); o2/r2 hits the
      // limit and o3/r3 404s — the rate condition dominates triage.
      const fetchers1 = createScriptedFetchers({
        repos: ROSTER,
        behaviors: {
          commits: {
            failKeys: new Map([
              ['o2/r2', rateError()],
              ['o3/r3', { message: 'Not found', code: 'NOT_FOUND' }],
            ]),
          },
        },
        log,
      });
      const job1 = await store.createJob({ userId: USER, kind: 'initial' });
      const out1 = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job1.id,
        store,
        fetchers: fetchers1,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out1.status, 'failed');
      assert.equal(out1.perResource.commits, undefined, 'aborted phases stay absent, not failed');
      const finished1 = await store.getLatestJob(USER);
      assert.equal(finished1.errorCode, 'RATE_LIMITED');
      assert.ok(finished1.resumeAt instanceof Date, 'resume time must persist for the status display');
      assert.ok(!log.some((c) => c.resource === 'pulls'), 'nothing downstream runs after a rate abort');
      const states1 = await store.getStates(USER);
      assert.equal(states1.get('repositories').status, 'done', 'prior good data is kept');
      assert.equal(states1.get('commits').status, 'rate_limited');
      const cursor1 = states1.get('commits').cursor;
      assert.ok(cursor1.repos['o1/r1'], 'the finished repo checkpoint survives');
      assert.ok(cursor1.completed.includes('o1/r1'));

      // Run 2 (healed API): roster refetches (fresh), finished repos skipped.
      const log2 = [];
      const fetchers2 = createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: log2 });
      const job2 = await store.createJob({ userId: USER, kind: 'resync' });
      const out2 = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job2.id,
        store,
        fetchers: fetchers2,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out2.status, 'succeeded');
      const reposCalls = log2.filter((c) => c.resource === 'repositories').length;
      assert.equal(reposCalls, 1, 'the cheap roster refetches for freshness');
      const commitsCalls = log2.filter((c) => c.resource === 'commits');
      assert.equal(commitsCalls.length, 1);
      assert.deepEqual(commitsCalls[0].repos, ['o2/r2', 'o3/r3'], 'finished repos are not refetched');
      assert.ok(commitsCalls[0].cursorKeys.includes('o1/r1'), 'stored cursors are reused incrementally');
    });
  });

  describe('timeout', () => {
    it('fails honestly on timeout, keeps partial progress, never corrupts afterwards', async () => {
      const store = createFakeStore();
      let releaseCommits;
      const holdOpen = new Promise((resolve) => {
        releaseCommits = resolve;
      });
      const fetchers = createScriptedFetchers({
        repos: ROSTER,
        behaviors: { commits: { defer: { promise: holdOpen } } },
        log: [],
      });
      const job = await store.createJob({ userId: USER, kind: 'initial' });
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 40,
      });
      assert.equal(out.status, 'failed', 'timeout resolves (not rejects) with a failed summary');
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.status, 'failed');
      assert.equal(finished.errorCode, 'INTERNAL');
      assert.ok(finished.error.includes('timed out'), 'the error must explain resumption');
      const states = await store.getStates(USER);
      assert.equal(states.get('repositories').status, 'done', 'partial progress survives the timeout');
      // The loser pipeline finishes later; its writes must be suppressed.
      releaseCommits();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const still = await store.getLatestJob(USER);
      assert.equal(still.status, 'failed');
      assert.ok(still.error.includes('timed out'), 'late writes must not corrupt the terminal state');
      const statesAfter = await store.getStates(USER);
      assert.equal(statesAfter.get('commits'), undefined, 'no phase state may appear after the timeout');
    });
  });

  describe('idempotent reruns', () => {
    it('reruns safely after success: incremental cursors reused, no duplicate records', async () => {
      const store = createFakeStore();
      const log = [];
      const fetchers = createScriptedFetchers({ repos: ROSTER, behaviors: {}, log });
      const job1 = await store.createJob({ userId: USER, kind: 'initial' });
      const out1 = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job1.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out1.status, 'succeeded');
      const job2 = await store.createJob({ userId: USER, kind: 'resync' });
      const out2 = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job2.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out2.status, 'succeeded');
      // Incremental reuse: the second run passes stored cursors back in.
      const commitsCalls = log.filter((c) => c.resource === 'commits');
      assert.equal(commitsCalls.length, 2);
      assert.deepEqual(commitsCalls[1].cursorKeys.sort(), ['o1/r1', 'o2/r2', 'o3/r3']);
      // No duplicated persisted records: one state doc per resource.
      assert.equal(store._states.size, 5);
      assert.equal(await store.countJobs(USER), 2, 'history grows; active jobs never duplicate');
      const active = await store.findActiveJob(USER);
      assert.equal(active, null);
    });

    it('repeated status reads are stable', async () => {
      const store = createFakeStore();
      const fetchers = createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: [] });
      const job = await store.createJob({ userId: USER, kind: 'initial' });
      await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      const first = await getStatus(USER, { store });
      const second = await getStatus(USER, { store });
      assert.deepEqual(first, second);
    });
  });

  describe('store failure', () => {
    it('records an honest failure when a read fails but the terminal write works', async () => {
      const store = createFakeStore({ failMethods: ['getStates'] });
      const fetchers = createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: [] });
      const job = await store.createJob({ userId: USER, kind: 'initial' });
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out.status, 'failed', 'an unreadable store fails the run, it never fakes success');
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.errorCode, 'INTERNAL');
    });

    it('rejects (never misreports) when even the terminal write fails', async () => {
      const store = createFakeStore({ failMethods: ['finishJobCAS'] });
      const fetchers = createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: [] });
      const job = await store.createJob({ userId: USER, kind: 'initial' });
      await assert.rejects(
        runSync({
          userId: USER,
          userDoc: USER_DOC,
          jobId: job.id,
          store,
          fetchers,
          persist: createFakePersist(),
          timeoutMs: 60000,
        }),
        (err) => err.code === 'INTERNAL'
      );
    });
  });
});
