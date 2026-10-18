/**
 * T9.2 observability tests — structured-log contract (reqId/jobId), sync
 * history shape, and operational-error hygiene.
 *
 * architecture.md §15: "pino JSON logs with reqId (per request) and jobId
 * (per sync)". rules.md §13: every request log line carries reqId, every job
 * log line carries jobId + userId, and tokens/secrets are NEVER logged.
 *
 * These tests pin those properties against the REAL wiring:
 * - reqId: createApp() binds `req.log = <logger>.child({ reqId })`; we inject
 *   a capturing logger and assert the request line carries the echoed id.
 * - jobId: startSync() passes an injectable `log` into the orchestrator; we
 *   assert the sync run's lines carry the claimed jobId.
 * - history: GET /api/sync/status exposes the documented SyncJob fields the
 *   Settings UI renders (kind/status/startedAt/finishedAt/jobId).
 * - hygiene: a GitHub token present in the user document never appears in
 *   logs, and a raw driver error (Mongo URI with credentials) never reaches
 *   the caller as a raw message.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { createApp } = require('../src/app');
const { startSync, getStatus } = require('../src/services/sync/sync.service');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createScriptedFetchers } = require('./test-helpers/fakeSyncFetchers');
const { createFakePersist } = require('./test-helpers/fakeSyncPersist');

const ROSTER = [{ owner: 'o1', name: 'r1', githubId: 11 }];
const MARKER = 'enc-MARKER-SECRET-xyz'; // stands in for an encrypted GitHub token

/** In-memory pino-like sink: records every entry; child() binds reqId. */
function createCaptureLogger() {
  const entries = [];
  const make = (bindings = {}) => ({
    info: (o) => entries.push({ ...bindings, ...o, level: 'info' }),
    warn: (o) => entries.push({ ...bindings, ...o, level: 'warn' }),
    error: (o) => entries.push({ ...bindings, ...o, level: 'error' }),
    debug: (o) => entries.push({ ...bindings, ...o, level: 'debug' }),
  });
  const root = make();
  return {
    entries,
    child: (bindings) => make(bindings),
    info: root.info,
    warn: root.warn,
    error: root.error,
    debug: root.debug,
  };
}

function syncDeps(store, log, overrides = {}) {
  const launched = [];
  return {
    store,
    fetchers: createScriptedFetchers({ repos: ROSTER, behaviors: {}, log: [] }),
    persist: createFakePersist(),
    loadUser: async () => ({ githubTokenEnc: MARKER, login: 'tester' }),
    launch: (promise, ctx) => {
      launched.push({ promise, ctx });
    },
    timeoutMs: 60000,
    log,
    launched,
    ...overrides,
  };
}

async function closeServer(server) {
  await new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

describe('T9.2 structured logs carry reqId on requests', () => {
  let capture;
  let server;
  let baseUrl;

  before(async () => {
    capture = createCaptureLogger();
    const app = createApp({ logger: capture });
    server = app.listen(0);
    await new Promise((resolve) => server.on('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await closeServer(server);
  });

  it('binds reqId to every request-scoped log line (matches the echoed header)', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const headerId = res.headers.get('x-request-id');
    assert.ok(headerId, 'X-Request-Id must be echoed on the response');

    const line = capture.entries.find((e) => e.msg === 'health check');
    assert.ok(line, 'the health controller must log through req.log');
    assert.equal(line.reqId, headerId, 'the log line must carry the same reqId as the response header');
  });
});

describe('T9.2 structured logs carry jobId on sync runs', () => {
  it('logs sync lifecycle with jobId (and never the GitHub token)', async () => {
    const store = createFakeStore();
    const log = createCaptureLogger();
    const deps = syncDeps(store, log);
    const started = await startSync('user-1', { kind: 'initial', ...deps });
    assert.ok(started.jobId);
    await Promise.all(deps.launched.map((l) => l.promise));

    const jobLines = log.entries.filter((e) => e.jobId === started.jobId);
    assert.ok(jobLines.length >= 2, 'the run must emit lifecycle lines with jobId');
    assert.ok(
      jobLines.some((e) => e.msg === 'sync started'),
      'a "sync started" line must carry jobId'
    );
    assert.ok(
      jobLines.some((e) => e.msg === 'sync finished'),
      'a "sync finished" line must carry jobId'
    );
    for (const line of jobLines) {
      assert.ok('userId' in line, 'job log lines must carry userId (rules.md §13)');
      assert.ok(!JSON.stringify(line).includes(MARKER), 'the GitHub token must never be logged');
    }
  });

  it('never leaks a raw driver error (Mongo URI with credentials) to the caller', async () => {
    const log = createCaptureLogger();
    const leakStore = {
      findActiveJob: async () => null,
      createJob: async () => {
        throw new Error('connect ECONNREFUSED mongodb://user:secret@127.0.0.1:27017/frieday');
      },
    };
    await assert.rejects(
      startSync('user-1', { kind: 'initial', store: leakStore, log, ...syncDeps(leakStore, log) }),
      (err) => {
        assert.equal(err.code, 'INTERNAL', 'driver errors are wrapped into the typed envelope');
        assert.equal(err.retryable, true);
        assert.ok(!err.message.includes('mongodb'), 'the raw URI must not reach the caller');
        assert.ok(!err.message.includes('secret'), 'credentials must not reach the caller');
        return true;
      }
    );
  });
});

describe('T9.2 sync history is visible with the documented fields', () => {
  it('exposes the SyncJob fields the Settings UI renders (last 20/user)', async () => {
    const store = createFakeStore();
    const log = createCaptureLogger();
    const deps = syncDeps(store, log);
    const started = await startSync('user-1', { kind: 'resync', ...deps });
    await Promise.all(deps.launched.map((l) => l.promise));

    const status = await getStatus('user-1', { store });
    assert.equal(status.status, 'succeeded');
    assert.ok(Array.isArray(status.history));
    assert.ok(status.history.length >= 1);

    const [job] = status.history;
    assert.equal(job.jobId, started.jobId);
    assert.equal(job.kind, 'resync');
    assert.equal(job.status, 'succeeded');
    assert.ok(job.startedAt instanceof Date || job.startedAt, 'startedAt present');
    assert.ok(job.finishedAt, 'finishedAt present after completion');
    assert.ok(!JSON.stringify(status.history).includes(MARKER), 'history must never carry the token');
  });

  it('is per-user isolated (a user only ever sees their own jobs)', async () => {
    const store = createFakeStore();
    const log = createCaptureLogger();
    const deps = syncDeps(store, log);
    await startSync('user-a', { kind: 'initial', ...deps });
    await Promise.all(deps.launched.map((l) => l.promise));

    const other = await getStatus('user-b', { store });
    assert.equal(other.status, 'idle');
    assert.deepEqual(other.history, [], 'user B must not see user A sync history');
  });
});
