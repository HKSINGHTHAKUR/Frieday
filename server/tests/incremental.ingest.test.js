/**
 * T7.2 incremental single-repo ingest tests — runner + pure guards.
 *
 * Covers:
 * - A. incremental ingest: single repository only, `since = lastSyncedAt`
 *   passed to the fetchers, NO roster refetch (no full user sync), correct
 *   per-repo persistence + boundary stamping.
 * - B. stale-event guard: older ignored, newer accepted, equal ignored,
 *   state cannot regress (boundary only advances).
 * - F. failure handling: 401/403 (UNAUTHENTICATED), 429/403-limit
 *   (RATE_LIMITED + resumeAt), 404, 5xx/network, Mongo persistence failure.
 * - G. freshness: deterministic measurement helper.
 *
 * No MongoDB, no live GitHub: injected fake store + fake fetchers + fake
 * persistence (same conventions as the T2.3 suite).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { runIncrementalRepoSync } = require('../src/services/ingestion/incremental.ingest');
const {
  isStaleEvent,
  extractEventTimestamp,
  computeFreshnessMs,
} = require('../src/services/ingestion/incremental.guards');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createFakePersist } = require('./test-helpers/fakeSyncPersist');

const USER = 'user-1';
const USER_DOC = { githubTokenEnc: 'enc-test-marker' };
const REPO = { owner: 'o1', name: 'r1', githubId: 11 };
const BOUNDARY = new Date('2024-01-01T00:00:00.000Z');

const silentLog = { info() {}, warn() {}, error() {} };

/**
 * Scripted single-repo fetchers that RECORD the cursors passed in, so tests
 * can assert `since = lastSyncedAt` reached the GitHub layer. `behaviors`:
 * - `{ throw: err }` (list-level throw), or
 * - `{ errorKeys: Map(key -> { code, message, resumeAt? }) }` (per-repo errors),
 * - `{ capReached: true }` (the resource reports its fetch cap was hit).
 */
function makeIncrementalFetchers({ behaviors = {}, log = [] } = {}) {
  function run(resource, itemKey, userDoc, repos, opts = {}) {
    const out = { [itemKey]: [], cursors: new Map(), capReached: false, errors: new Map() };
    const behavior = behaviors[resource] ?? {};
    if (behavior.throw) throw behavior.throw;
    for (const repo of repos) {
      const key = `${repo.owner}/${repo.name}`;
      if (behavior.errorKeys && behavior.errorKeys.has(key)) {
        out.errors.set(key, behavior.errorKeys.get(key));
        continue;
      }
      const count = behavior.perRepo ?? 2;
      for (let i = 0; i < count; i++) out[itemKey].push({ repoId: repo.repoId, i });
      out.cursors.set(key, { page: 2, since: opts.cursors?.get(key)?.since ?? null });
    }
    if (behavior.capReached) out.capReached = true;
    log.push({
      resource,
      repos: repos.map((r) => `${r.owner}/${r.name}`),
      cursors: opts.cursors ? new Map(opts.cursors) : new Map(),
    });
    return out;
  }
  return {
    log,
    fetchCommits: (u, repos, opts) => run('commits', 'commits', u, repos, opts),
    fetchPulls: (u, repos, opts) => run('pulls', 'prs', u, repos, opts),
    fetchIssues: (u, repos, opts) => run('issues', 'issues', u, repos, opts),
    fetchLanguages: (u, repos, opts) => run('languages', 'languageSnapshots', u, repos, opts),
  };
}

async function runOnce({
  repo = REPO,
  since = BOUNDARY,
  behaviors = {},
  storeOpts,
  fetchers,
  persist = createFakePersist(),
} = {}) {
  const store = createFakeStore(storeOpts);
  const log = [];
  const f = fetchers ?? makeIncrementalFetchers({ behaviors, log });
  const job = await store.createJob({ userId: USER, kind: 'incremental' });
  const out = await runIncrementalRepoSync({
    userId: USER,
    userDoc: USER_DOC,
    userLogin: 'tester',
    jobId: job.id,
    repo,
    since,
    store,
    fetchers: f,
    persist,
    log: silentLog,
    timeoutMs: 60000,
  });
  return { store, fetchers: f, job, out };
}

describe('incremental.ingest (T7.2) — runner', () => {
  describe('A. incremental single-repo ingest', () => {
    it('processes ONLY the affected repository (no roster refetch, no full user sync)', async () => {
      const { fetchers, out, store } = await runOnce();
      assert.equal(out.status, 'succeeded');
      const resources = fetchers.log.map((c) => c.resource);
      assert.deepEqual(resources, ['commits', 'pulls', 'issues', 'languages']);
      for (const call of fetchers.log) {
        assert.deepEqual(call.repos, ['o1/r1'], `${call.resource} must target only o1/r1`);
      }
      assert.ok(!resources.includes('repositories'), 'roster must never be refetched on webhook ingest');
      assert.equal(store.repoSynced.length, 1);
      assert.equal(store.repoSynced[0].githubId, REPO.githubId);
    });

    it('passes since = lastSyncedAt into the GitHub fetch cursors', async () => {
      const since = new Date('2024-03-15T12:00:00.000Z');
      const { fetchers } = await runOnce({ since });
      const iso = since.toISOString();
      for (const call of fetchers.log) {
        if (call.resource === 'languages') continue; // no since for languages (snapshot endpoint)
        const cursor = call.cursors.get('o1/r1');
        assert.ok(cursor, `${call.resource} must receive a per-repo cursor`);
        assert.equal(cursor.since, iso, `${call.resource} must fetch with since=${iso}`);
      }
    });

    it('omits since when there is no persisted boundary (first-time repo)', async () => {
      const { fetchers } = await runOnce({ since: null });
      for (const call of fetchers.log) {
        if (call.resource === 'languages') continue;
        assert.equal(
          call.cursors.get('o1/r1'),
          undefined,
          `${call.resource} must not set since without a boundary`
        );
      }
    });

    it('persists fetched DTOs and stamps the per-repo boundary + job terminal state', async () => {
      const persist = createFakePersist();
      const { store, out } = await runOnce({ persist });
      assert.equal(out.status, 'succeeded');
      assert.deepEqual(out.perResource, {
        commits: 'done',
        pulls: 'done',
        issues: 'done',
        languages: 'done',
      });
      const resources = persist.calls.filter((c) => c.op === 'persistFetched').map((c) => c.resource);
      assert.deepEqual(resources, ['commits', 'pulls', 'issues', 'languages']);
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.status, 'succeeded');
      assert.equal(store.repoSynced.length, 1);
    });

    it('updates SyncState freshness (status done + lastSyncedAt) after each successful resource persist', async () => {
      const { store, out } = await runOnce();
      assert.equal(out.status, 'succeeded');
      for (const resource of ['commits', 'pulls', 'issues', 'languages']) {
        const state = store._states.get(`${USER}:${resource}`);
        assert.ok(state, `saveState must be called for ${resource}`);
        assert.equal(state.status, 'done');
        assert.ok(state.lastSyncedAt instanceof Date, `${resource} must advance lastSyncedAt`);
      }
    });

    it('does NOT update SyncState freshness when a resource persists as a partial failure', async () => {
      const { store, out } = await runOnce({
        behaviors: {
          commits: { errorKeys: new Map([['o1/r1', { message: 'Not found', code: 'NOT_FOUND' }]]) },
        },
      });
      assert.equal(out.status, 'failed');
      const state = store._states.get(`${USER}:commits`);
      assert.ok(!state || state.status !== 'done', 'a failed resource must not be marked fresh');
    });

    it('does NOT advance the per-repo boundary when a resource hits the fetch cap', async () => {
      const { store, out } = await runOnce({
        behaviors: { commits: { capReached: true } },
      });
      assert.equal(out.status, 'succeeded', 'a capped fetch still completes the run');
      assert.equal(store.repoSynced.length, 0, 'boundary must not advance past truncated data');
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.status, 'succeeded');
    });

    it('retains the previous boundary when ANY of several resources hits the cap', async () => {
      const { store } = await runOnce({
        behaviors: { pulls: { capReached: true } },
      });
      assert.equal(store.repoSynced.length, 0, 'one capped resource blocks the boundary advance');
    });

    it('still advances the boundary when no resource hits the cap', async () => {
      const { store, out } = await runOnce();
      assert.equal(out.status, 'succeeded');
      assert.equal(store.repoSynced.length, 1);
    });
  });

  describe('B. stale-event guard', () => {
    it('ignores an event older than the persisted boundary', () => {
      const event = new Date('2024-01-01T00:00:00.000Z');
      const boundary = new Date('2024-01-02T00:00:00.000Z');
      assert.equal(isStaleEvent(event, boundary), true);
    });

    it('accepts an event newer than the persisted boundary', () => {
      const event = new Date('2024-01-03T00:00:00.000Z');
      const boundary = new Date('2024-01-02T00:00:00.000Z');
      assert.equal(isStaleEvent(event, boundary), false);
    });

    it('treats an equal-boundary event as stale (no regression, no re-ingest)', () => {
      const boundary = new Date('2024-01-02T00:00:00.000Z');
      assert.equal(isStaleEvent(new Date('2024-01-02T00:00:00.000Z'), boundary), true);
    });

    it('cannot classify (eligible) when the event timestamp or boundary is missing', () => {
      assert.equal(isStaleEvent(null, new Date('2024-01-02T00:00:00.000Z')), false);
      assert.equal(isStaleEvent(new Date('2024-01-01T00:00:00.000Z'), null), false);
      assert.equal(isStaleEvent(null, null), false);
      assert.equal(isStaleEvent(new Date('not-a-date'), new Date('2024-01-02T00:00:00.000Z')), false);
    });

    it('extracts the newest verified timestamp from a payload (repo/PR/issue)', () => {
      const payload = {
        repository: { id: 1, updated_at: '2024-01-01T00:00:00.000Z' },
        pull_request: { updated_at: '2024-01-03T00:00:00.000Z' },
      };
      assert.equal(extractEventTimestamp(payload).getTime(), new Date('2024-01-03T00:00:00.000Z').getTime());
      assert.equal(extractEventTimestamp({ repository: { id: 1 } }), null);
      assert.equal(extractEventTimestamp({}), null);
    });
  });

  describe('F. failure handling', () => {
    it('aborts with UNAUTHENTICATED (401/403) and keeps prior good data', async () => {
      const { store, out } = await runOnce({
        behaviors: { commits: { throw: { message: 'Bad credentials', code: 'UNAUTHENTICATED' } } },
      });
      assert.equal(out.status, 'failed');
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.errorCode, 'UNAUTHENTICATED');
      assert.equal(store.repoSynced.length, 0, 'a failed run must not advance the boundary');
    });

    it('aborts with RATE_LIMITED + resumeAt (429 / exhausted 403)', async () => {
      const resumeAt = new Date(Date.now() + 3600000);
      const { store, out } = await runOnce({
        behaviors: {
          pulls: { throw: { message: 'Rate limit reached.', code: 'RATE_LIMITED', resumeAt } },
        },
      });
      assert.equal(out.status, 'failed');
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.errorCode, 'RATE_LIMITED');
      assert.equal(new Date(finished.resumeAt).getTime(), resumeAt.getTime());
    });

    it('aborts on a per-repo RATE_LIMITED entry in the errors map', async () => {
      const resumeAt = new Date(Date.now() + 3600000);
      const { store, out } = await runOnce({
        behaviors: {
          issues: {
            errorKeys: new Map([['o1/r1', { message: 'Rate limited', code: 'RATE_LIMITED', resumeAt }]]),
          },
        },
      });
      assert.equal(out.status, 'failed');
      assert.equal((await store.getLatestJob(USER)).errorCode, 'RATE_LIMITED');
    });

    it('records a per-resource NOT_FOUND (404, repo no longer accessible) as a partial failure', async () => {
      const { store, out } = await runOnce({
        behaviors: {
          commits: { errorKeys: new Map([['o1/r1', { message: 'Not found', code: 'NOT_FOUND' }]]) },
        },
      });
      assert.equal(out.status, 'failed');
      assert.equal(out.perResource.commits, 'failed');
      const finished = await store.getLatestJob(USER);
      assert.equal(finished.status, 'failed');
    });

    it('records a per-resource GITHUB_UNREACHABLE (5xx/network) as a partial failure', async () => {
      const { out } = await runOnce({
        behaviors: {
          pulls: { errorKeys: new Map([['o1/r1', { message: 'Unreachable', code: 'GITHUB_UNREACHABLE' }]]) },
        },
      });
      assert.equal(out.status, 'failed');
      assert.equal(out.perResource.pulls, 'failed');
    });

    it('rejects (never fakes success) when persistence itself fails', async () => {
      const store = createFakeStore({ failMethods: ['finishJobCAS'] });
      const fetchers = makeIncrementalFetchers({ behaviors: {}, log: [] });
      const job = await store.createJob({ userId: USER, kind: 'incremental' });
      await assert.rejects(
        runIncrementalRepoSync({
          userId: USER,
          userDoc: USER_DOC,
          jobId: job.id,
          repo: REPO,
          since: BOUNDARY,
          store,
          fetchers,
          persist: createFakePersist(),
          log: silentLog,
          timeoutMs: 60000,
        }),
        (err) => err.code === 'INTERNAL'
      );
    });

    it('logs a terminal-write failure safely (no raw driver/connection details)', async () => {
      const errors = [];
      const base = createFakeStore();
      const store = {
        ...base,
        async finishJobCAS() {
          throw new Error('connect ECONNREFUSED mongodb://user:secret@127.0.0.1:27017/frieday');
        },
      };
      const fetchers = makeIncrementalFetchers({ behaviors: {}, log: [] });
      const job = await store.createJob({ userId: USER, kind: 'incremental' });
      await assert.rejects(
        runIncrementalRepoSync({
          userId: USER,
          userDoc: USER_DOC,
          jobId: job.id,
          repo: REPO,
          since: BOUNDARY,
          store,
          fetchers,
          persist: createFakePersist(),
          timeoutMs: 60000,
          log: { info() {}, warn() {}, error: (entry) => errors.push(entry) },
        }),
        (err) => err.code === 'INTERNAL'
      );
      const entry = errors.find((e) => e.msg === 'terminal state write failed');
      assert.ok(entry, 'the terminal-write failure must be logged');
      assert.equal(entry.code, 'INTERNAL');
      assert.equal(entry.operation, 'terminal-write');
      assert.ok(!JSON.stringify(entry).includes('secret'), 'sensitive connection string must not be logged');
      assert.equal('error' in entry, false, 'raw driver message must not be logged');
      assert.equal('err' in entry, false, 'raw error object must not be logged');
    });
  });

  describe('G. freshness measurement', () => {
    it('computes a deterministic duration from received/started/completed', () => {
      assert.equal(computeFreshnessMs({ receivedAt: 1000, startedAt: 1005, completedAt: 1010 }), 10);
      assert.equal(computeFreshnessMs({ receivedAt: 5000, startedAt: 5000, completedAt: 5000 }), 0);
    });

    it('returns null when timestamps are missing or out of order (no invented measurement)', () => {
      assert.equal(computeFreshnessMs({ receivedAt: 1000, startedAt: 1005 }), null);
      assert.equal(computeFreshnessMs({}), null);
      assert.equal(computeFreshnessMs({ receivedAt: 2000, startedAt: 1000, completedAt: 3000 }), null);
      assert.equal(computeFreshnessMs({ receivedAt: 1000, startedAt: 1005, completedAt: 'x' }), null);
    });
  });
});
