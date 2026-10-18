/**
 * GET /api/insights freshness + generatedAt contract tests (T5.1, T4.3).
 *
 * DB-free: injects the freshness primitives (getLastRecomputeAt / isCacheValid /
 * recomputeIntelligence), the insights read (findInsights), and lastSyncedAt so
 * the route's freshness gate and timestamp contract are exercised end to end
 * without MongoDB. Mirrors insights.explain.routes.test.js harness conventions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
process.env.AI_ENABLED = 'false';
delete process.env.AI_PROVIDER;
delete process.env.AI_MODEL;
delete process.env.AI_BASE_URL;
delete process.env.AI_API_KEY;

const { createInsightsRouter } = require('../src/routes/insights.routes');

function silentLog() {
  return { info() {}, warn() {}, error() {} };
}

function fakeAuth(userId) {
  return (req, _res, next) => {
    req.user = { id: userId, githubId: 42, login: 'tester' };
    next();
  };
}

function insightDoc(overrides = {}) {
  return {
    _id: '64b64b64b64b64b64b64b64b',
    templateId: 'activity_momentum',
    title: 'Activity Momentum',
    text: 'Activity increased (+30.1%) vs prior 30d.',
    metrics: { currentCommits: 121, previousCommits: 93, deltaPercent: 30.1, state: 'up' },
    evidence: { repoIds: [], commitShas: [], prNumbers: [], bucketStarts: [] },
    confidence: 'High',
    generatedAt: new Date('2026-10-06T12:00:00Z'),
    ...overrides,
  };
}

const FIXED_SYNC = new Date('2026-10-06T00:00:00Z');
const STALE_GENERATED = new Date('2026-10-06T12:00:00Z');

function mountRouter({ userId = 'u1', deps = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = silentLog();
    next();
  });
  app.use(
    '/api',
    createInsightsRouter({
      authMiddleware: fakeAuth(userId),
      deps,
    })
  );
  const server = app.listen(0);
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve) => {
    server.closeAllConnections ? server.closeAllConnections() : null;
    server.close(resolve);
  });
}

async function get(baseUrl, path) {
  const res = await fetch(baseUrl + path);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe('GET /api/insights freshness + generatedAt contract', () => {
  it('B/D: serves fresh persisted insights with a valid generatedAt for every range, no recompute', async () => {
    const recomputeCalls = [];
    const seenRanges = [];
    const base = new Date('2026-10-06T12:00:00Z');
    const docs = {
      '30d': insightDoc({ generatedAt: base }),
      '90d': insightDoc({ generatedAt: new Date(base.getTime() + 1000), templateId: 'consistency' }),
      '12m': insightDoc({ generatedAt: new Date(base.getTime() + 2000), templateId: 'consistency' }),
    };
    const { server, baseUrl } = mountRouter({
      userId: 'u-ranges',
      deps: {
        getLastSyncedAt: async () => FIXED_SYNC,
        getLastRecomputeAt: async (userId, range) => {
          seenRanges.push(range);
          return docs[range].generatedAt;
        },
        isCacheValid: async () => true,
        recomputeIntelligence: async ({ range }) => recomputeCalls.push(range),
        findInsights: async (userId, range) => [docs[range]],
      },
    });
    try {
      for (const range of ['30d', '90d', '12m']) {
        const { status, body } = await get(baseUrl, `/api/insights?range=${range}`);
        assert.equal(status, 200);
        assert.equal(body.fromCache, false);
        assert.equal(body.insights.length, 1);
        const ins = body.insights[0];
        assert.ok(ins.generatedAt, `${range}: generatedAt present`);
        assert.ok(
          !Number.isNaN(new Date(ins.generatedAt).getTime()),
          `${range}: generatedAt is a valid date`
        );
        assert.equal(
          ins.generatedAt,
          docs[range].generatedAt.toISOString(),
          `${range}: generatedAt matches the persisted computation`
        );
      }
      assert.deepEqual(recomputeCalls, [], 'fresh cache must not recompute');
      assert.deepEqual(seenRanges, ['30d', '90d', '12m'], 'each range is gated independently');
    } finally {
      await closeServer(server);
    }
  });

  it('E: stale cache recomputes once and serves the newly persisted generatedAt', async () => {
    const recomputeCalls = [];
    let persistedAt = STALE_GENERATED;
    const { server, baseUrl } = mountRouter({
      userId: 'u-stale',
      deps: {
        getLastSyncedAt: async () => FIXED_SYNC,
        getLastRecomputeAt: async () => STALE_GENERATED,
        isCacheValid: async () => false,
        recomputeIntelligence: async () => {
          recomputeCalls.push(1);
          persistedAt = new Date('2026-10-06T18:00:00Z');
        },
        findInsights: async () => [insightDoc({ generatedAt: persistedAt })],
      },
    });
    try {
      const { status, body } = await get(baseUrl, '/api/insights?range=30d');
      assert.equal(status, 200);
      assert.equal(recomputeCalls.length, 1, 'recompute runs exactly once when stale');
      assert.equal(body.insights[0].generatedAt, new Date('2026-10-06T18:00:00Z').toISOString());
      assert.ok(
        new Date(body.insights[0].generatedAt) > STALE_GENERATED,
        'timestamp advances to the new computation'
      );
    } finally {
      await closeServer(server);
    }
  });

  it('E: first-ever request (no prior recompute) recomputes before serving', async () => {
    const recomputeCalls = [];
    const { server, baseUrl } = mountRouter({
      userId: 'u-first',
      deps: {
        getLastSyncedAt: async () => FIXED_SYNC,
        getLastRecomputeAt: async () => null,
        isCacheValid: async (userId, range, lastRecomputeAt) => {
          assert.equal(lastRecomputeAt, null);
          return false;
        },
        recomputeIntelligence: async ({ range }) => recomputeCalls.push(range),
        findInsights: async () => [insightDoc({ generatedAt: new Date('2026-10-06T18:00:00Z') })],
      },
    });
    try {
      const { status, body } = await get(baseUrl, '/api/insights?range=30d');
      assert.equal(status, 200);
      assert.equal(recomputeCalls.length, 1);
      assert.ok(body.insights[0].generatedAt);
    } finally {
      await closeServer(server);
    }
  });

  it('F: a 60s API cache hit returns the same timestamp without re-running the gate', async () => {
    const recomputeCalls = [];
    const generatedAt = new Date('2026-10-06T12:00:00Z');
    const { server, baseUrl } = mountRouter({
      userId: 'u-cachehit',
      deps: {
        getLastSyncedAt: async () => FIXED_SYNC,
        getLastRecomputeAt: async () => generatedAt,
        isCacheValid: async () => true,
        recomputeIntelligence: async () => recomputeCalls.push(1),
        findInsights: async () => [insightDoc({ generatedAt })],
      },
    });
    try {
      const first = await get(baseUrl, '/api/insights?range=30d');
      assert.equal(first.body.fromCache, false);
      const second = await get(baseUrl, '/api/insights?range=30d');
      assert.equal(second.body.fromCache, true, 'second call within TTL is a memo hit');
      assert.equal(
        second.body.insights[0].generatedAt,
        first.body.insights[0].generatedAt,
        'cache hit does not change the timestamp'
      );
      assert.equal(recomputeCalls.length, 0);
    } finally {
      await closeServer(server);
    }
  });

  it('G: insight content/evidence/template identity are passed through unchanged', async () => {
    const doc = insightDoc({
      _id: '64b64b64b64b64b64b64b64c',
      templateId: 'repository_concentration',
      title: 'Repository Concentration',
      text: '99% of commits in top 2 repos.',
      metrics: { totalCommits: 121, topRepoPct: 99, topTwoPct: 100, repoCount: 14 },
      evidence: {
        repoIds: ['64b64b64b64b64b64b64b64b'],
        commitShas: ['abc'],
        prNumbers: [],
        bucketStarts: [],
      },
      confidence: 'High',
      generatedAt: new Date('2026-10-06T12:00:00Z'),
    });
    const { server, baseUrl } = mountRouter({
      userId: 'u-identity',
      deps: {
        getLastSyncedAt: async () => FIXED_SYNC,
        getLastRecomputeAt: async () => doc.generatedAt,
        isCacheValid: async () => true,
        findInsights: async () => [doc],
      },
    });
    try {
      const { status, body } = await get(baseUrl, '/api/insights?range=30d');
      assert.equal(status, 200);
      const ins = body.insights[0];
      assert.equal(ins.id, doc._id);
      assert.equal(ins.templateId, doc.templateId);
      assert.equal(ins.title, doc.title);
      assert.equal(ins.text, doc.text);
      assert.deepEqual(ins.metrics, doc.metrics);
      assert.deepEqual(ins.evidence, doc.evidence);
      assert.equal(ins.confidence, doc.confidence);
      assert.equal(ins.generatedAt, doc.generatedAt.toISOString());
    } finally {
      await closeServer(server);
    }
  });

  it('H: empty activity still returns 200 with an empty insights array', async () => {
    const recomputeCalls = [];
    const { server, baseUrl } = mountRouter({
      userId: 'u-empty',
      deps: {
        getLastSyncedAt: async () => FIXED_SYNC,
        getLastRecomputeAt: async () => STALE_GENERATED,
        isCacheValid: async () => false,
        recomputeIntelligence: async () => recomputeCalls.push(1),
        findInsights: async () => [],
      },
    });
    try {
      const { status, body } = await get(baseUrl, '/api/insights?range=30d');
      assert.equal(status, 200);
      assert.deepEqual(body.insights, []);
      assert.equal(recomputeCalls.length, 1);
    } finally {
      await closeServer(server);
    }
  });

  it('I: freshness gate and read are scoped to the requesting user', async () => {
    const userId = 'u-scoped-42';
    const seenUserIds = [];
    const { server, baseUrl } = mountRouter({
      userId,
      deps: {
        getLastSyncedAt: async (uid) => {
          seenUserIds.push(['sync', uid]);
          return FIXED_SYNC;
        },
        getLastRecomputeAt: async (uid) => {
          seenUserIds.push(['recomputeAt', uid]);
          return STALE_GENERATED;
        },
        isCacheValid: async (uid) => {
          seenUserIds.push(['valid', uid]);
          return false;
        },
        recomputeIntelligence: async ({ userId: uid }) => seenUserIds.push(['recompute', uid]),
        findInsights: async (uid) => {
          seenUserIds.push(['read', uid]);
          return [insightDoc({ generatedAt: new Date('2026-10-06T18:00:00Z') })];
        },
      },
    });
    try {
      const { status } = await get(baseUrl, '/api/insights?range=30d');
      assert.equal(status, 200);
      for (const [op, uid] of seenUserIds) {
        assert.equal(uid, userId, `${op} must use the requesting user id`);
      }
    } finally {
      await closeServer(server);
    }
  });

  it('invalid range is rejected by validation before the handler', async () => {
    const { server, baseUrl } = mountRouter({
      userId: 'u-invalid',
      deps: {
        getLastSyncedAt: async () => FIXED_SYNC,
        getLastRecomputeAt: async () => STALE_GENERATED,
        isCacheValid: async () => true,
        findInsights: async () => [],
      },
    });
    try {
      const { status, body } = await get(baseUrl, '/api/insights?range=45d');
      assert.equal(status, 400);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    } finally {
      await closeServer(server);
    }
  });
});
