/**
 * Sync orchestrator tests (T2.3) — core pipeline behavior.
 *
 * Uses the in-memory fake store + scripted fake fetchers (no MongoDB, no
 * live GitHub, no real time beyond short deferred waits). Resume/timeout/
 * idempotency scenarios live in sync.resume.test.js.
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

function setup({ repos = ROSTER, behaviors = {}, storeOpts } = {}) {
  const store = createFakeStore(storeOpts);
  const log = [];
  const fetchers = createScriptedFetchers({ repos, behaviors, log });
  return { store, log, fetchers };
}

async function claim(store, kind = 'initial') {
  return store.createJob({
    userId: USER,
    kind,
    progress: { phase: 'repositories', done: 0, total: 1 },
    startedAt: new Date(),
  });
}

describe('sync.orchestrator (T2.3)', () => {
  describe('pipeline order + success', () => {
    it('runs resources in order repos -> commits -> pulls -> issues -> languages', async () => {
      const { store, log, fetchers } = setup();
      const job = await claim(store);
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out.status, 'succeeded');
      assert.deepEqual(
        log.map((c) => c.resource),
        ['repositories', 'commits', 'pulls', 'issues', 'languages']
      );
    });

    it('persists done states, counts, per-resource outcomes and user sync time', async () => {
      const { store, fetchers } = setup();
      const job = await claim(store);
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out.status, 'succeeded');
      assert.deepEqual(out.counts, { repositories: 2, commits: 4, pulls: 4, issues: 4, languages: 4 });
      assert.deepEqual(out.perResource, {
        repositories: 'done',
        commits: 'done',
        pulls: 'done',
        issues: 'done',
        languages: 'done',
      });
      const states = await store.getStates(USER);
      for (const resource of ['repositories', 'commits', 'pulls', 'issues', 'languages']) {
        assert.equal(states.get(resource).status, 'done', resource);
        assert.ok(states.get(resource).lastSyncedAt instanceof Date, resource);
      }
      assert.equal(store.syncedUsers.length, 1);
      assert.equal(String(store.syncedUsers[0].userId), USER);
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.status, 'succeeded');
      assert.ok(finished.finishedAt instanceof Date);
      assert.equal(finished.error, null);
    });

    it('tracks monotonic progress that completes exactly at done == total', async () => {
      const { store, fetchers } = setup();
      const job = await claim(store);
      await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      const dones = store.progressLog.filter((p) => p.jobId === job.id).map((p) => p.progress.done);
      assert.ok(dones.length > 0);
      for (let i = 1; i < dones.length; i++) {
        assert.ok(dones[i] >= dones[i - 1], `progress decreased: ${dones.join(',')}`);
      }
      const phases = store.progressLog.filter((p) => p.jobId === job.id).map((p) => p.progress.phase);
      const order = ['repositories', 'commits', 'pulls', 'issues', 'languages'];
      let last = -1;
      for (const phase of order) {
        const at = phases.indexOf(phase);
        assert.ok(at > last, `phase ${phase} out of order`);
        last = at;
      }
      const lastWrite = store.progressLog.filter((p) => p.jobId === job.id).pop().progress;
      assert.equal(lastWrite.done, lastWrite.total);
      assert.equal(lastWrite.total, 1 + 4 * ROSTER.length);
    });

    it('succeeds with zeros on an empty roster', async () => {
      const { store, fetchers } = setup({ repos: [] });
      const job = await claim(store);
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out.status, 'succeeded');
      assert.deepEqual(out.counts, { repositories: 0, commits: 0, pulls: 0, issues: 0, languages: 0 });
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.progress.done, finished.progress.total);
    });
  });

  describe('partial failure', () => {
    it('keeps good repos/phases when one repo fails, and fails honestly', async () => {
      const { store, log, fetchers } = setup({
        behaviors: {
          commits: { failKeys: new Map([['o2/r2', { message: 'Not found', code: 'NOT_FOUND' }]]) },
        },
      });
      const job = await claim(store);
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out.status, 'failed', 'partial failure must not be reported as success');
      assert.equal(out.perResource.repositories, 'done');
      assert.equal(out.perResource.commits, 'failed');
      assert.equal(out.counts.commits, 2, 'the good repo keeps its commits');
      // Later phases still ran (no abort on a repo-level failure).
      assert.ok(
        log.some((c) => c.resource === 'pulls'),
        'pulls must still run'
      );
      assert.ok(
        log.some((c) => c.resource === 'issues'),
        'issues must still run'
      );
      assert.ok(
        log.some((c) => c.resource === 'languages'),
        'languages must still run'
      );
      assert.equal(out.perResource.pulls, 'done');
      const states = await store.getStates(USER);
      assert.equal(states.get('repositories').status, 'done', 'prior good data is kept');
      assert.equal(states.get('commits').status, 'failed');
      assert.ok(states.get('commits').error.includes('o2/r2'), 'per-resource error names the failed repo');
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.status, 'failed');
      assert.ok(finished.error.includes('commits'), 'job error names the failed resource');
      assert.equal(store.syncedUsers.length, 0, 'failed runs must not advance lastSyncedAt');
    });
  });

  describe('auth abort', () => {
    it('aborts later phases on revoked token but keeps prior good state', async () => {
      const authErr = { message: 'Bad credentials', code: 'UNAUTHENTICATED' };
      const { store, log, fetchers } = setup({
        behaviors: { commits: { failKeys: new Map([['o1/r1', authErr]]) } },
      });
      const job = await claim(store);
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out.status, 'failed');
      assert.ok(!log.some((c) => c.resource === 'pulls'), 'nothing downstream may run after auth death');
      const states = await store.getStates(USER);
      assert.equal(states.get('repositories').status, 'done', 'prior good data is kept');
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.errorCode, 'UNAUTHENTICATED');
    });
  });

  describe('malformed input', () => {
    it('fails the resource (not the process) on malformed fetcher output', async () => {
      const { store, log, fetchers } = setup({
        behaviors: { commits: { raw: 'not-an-object' } },
      });
      // Bypass the multi shape entirely: replace the commits fetcher output.
      fetchers.fetchCommitsForRepositories = async () => 'garbage-string';
      const job = await claim(store);
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out.status, 'failed');
      assert.equal(out.perResource.commits, 'failed');
      assert.ok(
        log.some((c) => c.resource === 'pulls'),
        'later phases still run'
      );
    });

    it('treats a malformed stored cursor as empty and fetches everything', async () => {
      const { store, fetchers } = setup();
      await store.saveState(USER, 'commits', { status: 'failed', cursor: 'garbage-string', error: null });
      const job = await claim(store);
      const out = await runSync({
        userId: USER,
        userDoc: USER_DOC,
        jobId: job.id,
        store,
        fetchers,
        persist: createFakePersist(),
        timeoutMs: 60000,
      });
      assert.equal(out.status, 'succeeded');
      assert.equal(out.perResource.commits, 'done');
    });

    it('rejects missing runSync arguments instead of crashing', async () => {
      await assert.rejects(runSync({}), (err) => err.code === 'INTERNAL');
      await assert.rejects(
        runSync({ userId: USER, userDoc: USER_DOC, jobId: 'x' }),
        (err) => err.code === 'INTERNAL'
      );
    });
  });
});
