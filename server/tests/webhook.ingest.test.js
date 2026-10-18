/**
 * T7.2 webhook -> incremental-ingest wiring tests over real HTTP.
 *
 * The T7.1 trusted boundary stays fully intact: HMAC, dedupe, allowlist,
 * shape validation all run before T7.2 is reachable. These tests prove the
 * real default handler (triggerIncrementalIngest) only ever runs on
 * signature-verified, deduped, shape-validated events, and that it maps the
 * event to the affected user-scoped repository (never a payload userId).
 *
 * No MongoDB, no live GitHub: fake repository model + fake sync store + fake
 * fetchers/persistence/launch injected through the route deps.
 */
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
process.env.WEBHOOK_SECRET = 'hook-secret-for-tests-only';

const TEST_SECRET = 'hook-secret-for-tests-only';
const { createWebhooksRouter } = require('../src/routes/webhooks.routes');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createFakePersist } = require('./test-helpers/fakeSyncPersist');

function sign(body, secret = TEST_SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

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
      const result = rows.filter((r) => r.githubId === query.githubId).map((r) => ({ ...r }));
      return chain(result);
    },
  };
}

function makeFetchers(log = []) {
  function run(resource, itemKey, userDoc, repos, opts = {}) {
    const out = { [itemKey]: [], cursors: new Map(), capReached: false, errors: new Map() };
    for (const repo of repos) {
      const key = `${repo.owner}/${repo.name}`;
      out[itemKey].push({ repoId: repo.repoId, i: 0 });
      out.cursors.set(key, { page: 2, since: opts.cursors?.get(key)?.since ?? null });
    }
    log.push({ resource, repos: repos.map((r) => `${r.owner}/${r.name}`) });
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

const BOUNDARY = new Date('2024-01-02T00:00:00.000Z');

function setup({ repoRows = [], loadUser, activeJobs = [] } = {}) {
  const store = createFakeStore();
  for (const job of activeJobs) store.__seedJob(job);
  const launched = [];
  const fetchers = makeFetchers();
  const deliveries = new Set();
  const deliveryStore = {
    calls: 0,
    async recordDelivery({ deliveryId }) {
      deliveryStore.calls += 1;
      if (deliveries.has(deliveryId)) return 'duplicate';
      deliveries.add(deliveryId);
      return 'recorded';
    },
  };
  const deps = {
    deliveryStore,
    repoModel: makeFakeRepoModel(repoRows),
    store,
    loadUser: loadUser ?? (async () => ({ githubTokenEnc: 'marker', login: 'tester' })),
    launch: (promise, meta) => {
      launched.push({ promise, meta });
    },
    fetchers,
    persist: createFakePersist(),
    timeoutMs: 60000,
    config: { WEBHOOK_SECRET: TEST_SECRET },
  };
  const app = express();
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {}, error() {} };
    next();
  });
  app.use('/api/webhooks', createWebhooksRouter(deps));
  const server = app.listen(0);
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, deps, store, launched, fetchers };
}

async function close(server) {
  await new Promise((resolve) => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close(resolve);
  });
}

function post(baseUrl, { body, event = 'push', delivery = 'd-1', signature = sign(body) } = {}) {
  return fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': delivery,
      'X-Hub-Signature-256': signature,
    },
    body,
  });
}

const PUSH_NEWER = JSON.stringify({
  repository: { id: 11, full_name: 'o1/r1', updated_at: '2024-01-03T00:00:00.000Z' },
  ref: 'refs/heads/main',
  after: 'abc123',
});
const PUSH_STALE = JSON.stringify({
  repository: { id: 11, full_name: 'o1/r1', updated_at: '2024-01-01T00:00:00.000Z' },
  ref: 'refs/heads/main',
  after: 'abc123',
});
const PUSH_UNMAPPED = JSON.stringify({
  repository: { id: 999, full_name: 'ghost/ghost', updated_at: '2024-01-03T00:00:00.000Z' },
});
const PR_BODY = JSON.stringify({
  action: 'opened',
  repository: { id: 11, full_name: 'o1/r1', updated_at: '2024-01-03T00:00:00.000Z' },
  pull_request: { id: 9, number: 42, updated_at: '2024-01-03T00:00:00.000Z' },
});
const PING_BODY = JSON.stringify({ zen: 'Design for failure.', hook_id: 321 });

const ROW_A = {
  userId: 'user-a',
  owner: 'o1',
  name: 'r1',
  githubId: 11,
  githubUpdatedAt: BOUNDARY,
  lastSyncedAt: BOUNDARY,
};

describe('T7.2 webhook -> incremental ingest (HTTP)', () => {
  let ctx;
  afterEach(async () => {
    if (ctx) {
      await close(ctx.server);
      ctx = null;
    }
  });

  it('queues a single-repo incremental sync for the owning user (200 + launched)', async () => {
    ctx = setup({ repoRows: [ROW_A] });
    const res = await post(ctx.baseUrl, { body: PUSH_NEWER, delivery: 't72-1' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, event: 'push', deduped: false });
    assert.equal(ctx.launched.length, 1, 'exactly one run launched');
    await ctx.launched[0].promise;
    assert.equal(ctx.launched[0].meta.userId, 'user-a');
    assert.equal(ctx.launched[0].meta.repo, 11);
    const resources = ctx.fetchers.log.map((c) => c.resource);
    assert.deepEqual(resources, ['commits', 'pulls', 'issues', 'languages']);
    for (const call of ctx.fetchers.log) assert.deepEqual(call.repos, ['o1/r1']);
    assert.equal(ctx.store.repoSynced.length, 1, 'per-repo boundary stamped');
  });

  it('never triggers ingestion for an invalid signature (P0: unverified cannot reach T7.2)', async () => {
    ctx = setup({ repoRows: [ROW_A] });
    const res = await post(ctx.baseUrl, {
      body: PUSH_NEWER,
      delivery: 't72-bad',
      signature: sign(PUSH_NEWER, 'wrong'),
    });
    assert.equal(res.status, 401);
    assert.equal(ctx.launched.length, 0, 'no run may be launched');
    assert.equal(ctx.store._jobs.size, 0, 'no job may be created');
    assert.equal(ctx.fetchers.log.length, 0, 'no GitHub fetches may occur');
  });

  it('safely skips an event for a repository with no connected user (unmapped)', async () => {
    ctx = setup({ repoRows: [] });
    const res = await post(ctx.baseUrl, { body: PUSH_UNMAPPED, delivery: 't72-unmapped' });
    assert.equal(res.status, 200);
    assert.equal(ctx.launched.length, 0);
    assert.equal(ctx.store._jobs.size, 0);
  });

  it('ignores a stale event (payload timestamp at/before persisted boundary)', async () => {
    ctx = setup({ repoRows: [ROW_A] });
    const res = await post(ctx.baseUrl, { body: PUSH_STALE, delivery: 't72-stale' });
    assert.equal(res.status, 200);
    assert.equal(ctx.launched.length, 0, 'stale event must not launch ingest');
    assert.equal(ctx.store._jobs.size, 0, 'stale event must not create a job');
  });

  it('processes an event newer than the persisted boundary', async () => {
    ctx = setup({ repoRows: [ROW_A] });
    const res = await post(ctx.baseUrl, { body: PR_BODY, event: 'pull_request', delivery: 't72-pr' });
    assert.equal(res.status, 200);
    assert.equal(ctx.launched.length, 1);
    await ctx.launched[0].promise;
  });

  it('keeps ping a T7.1-only behavior (200 pong, zero ingest)', async () => {
    ctx = setup({ repoRows: [ROW_A] });
    const res = await post(ctx.baseUrl, { body: PING_BODY, event: 'ping', delivery: 't72-ping' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, pong: true });
    assert.equal(ctx.launched.length, 0);
    assert.equal(ctx.store._jobs.size, 0);
  });

  it('runs one independent sync per owning user for a shared repository (cross-user isolation)', async () => {
    const rowB = { ...ROW_A, userId: 'user-b' };
    ctx = setup({ repoRows: [ROW_A, rowB] });
    const res = await post(ctx.baseUrl, { body: PUSH_NEWER, delivery: 't72-shared' });
    assert.equal(res.status, 200);
    assert.equal(ctx.launched.length, 2, 'one sync per owning user');
    const userIds = ctx.launched.map((l) => l.meta.userId).sort();
    assert.deepEqual(userIds, ['user-a', 'user-b']);
    await Promise.all(ctx.launched.map((l) => l.promise));
  });

  it('skips a user with no connected GitHub account (disconnected)', async () => {
    ctx = setup({
      repoRows: [ROW_A],
      loadUser: async () => ({ githubTokenEnc: null, login: null }),
    });
    const res = await post(ctx.baseUrl, { body: PUSH_NEWER, delivery: 't72-disconnected' });
    assert.equal(res.status, 200);
    assert.equal(ctx.launched.length, 0, 'no run for a disconnected user');
    assert.equal(ctx.store._jobs.size, 0);
  });

  it('never trusts a payload userId: only user-scoped Repository rows map to users', async () => {
    // row belongs to user-a; the payload carries a bogus "user" object that
    // the trusted shapes strip anyway — only user-a may be touched.
    const evil = JSON.stringify({
      repository: { id: 11, full_name: 'o1/r1', updated_at: '2024-01-03T00:00:00.000Z' },
      user: { id: 999999, login: 'attacker' },
      sender: { id: 999999 },
    });
    ctx = setup({ repoRows: [ROW_A] });
    const res = await post(ctx.baseUrl, { body: evil, delivery: 't72-evil' });
    assert.equal(res.status, 200);
    assert.equal(ctx.launched.length, 1);
    assert.equal(ctx.launched[0].meta.userId, 'user-a');
  });

  it('captures freshness timestamps (receivedAt -> startedAt -> completedAt) on completion', async () => {
    ctx = setup({ repoRows: [ROW_A] });
    const res = await post(ctx.baseUrl, { body: PUSH_NEWER, delivery: 't72-fresh' });
    assert.equal(res.status, 200);
    assert.equal(ctx.launched.length, 1);
    const meta = ctx.launched[0].meta;
    assert.equal(typeof meta.receivedAt, 'number');
    assert.equal(typeof meta.startedAt, 'number');
    assert.ok(meta.startedAt >= meta.receivedAt);
    await ctx.launched[0].promise;
  });
});
