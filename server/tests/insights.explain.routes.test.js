/**
 * POST /api/insights/:id/explain endpoint tests (T6.1) — real Express over
 * HTTP (sync.routes.test.js conventions). AI-off gate runs before any DB
 * access, so the 501 path needs no database; the enabled paths use an
 * injected DB-free insight lookup + scripted fetch.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
// Disabled by default for this file's 501/404/auth tests.
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

function mountTestRouter({
  userId = 'u1',
  aiEnabled = false,
  insightDoc,
  fetchImpl,
  envOverrides = {},
} = {}) {
  const config = {
    AI_ENABLED: aiEnabled,
    AI_PROVIDER: envOverrides.provider ?? 'openai',
    AI_MODEL: envOverrides.model ?? 'test-model',
    AI_BASE_URL: envOverrides.baseUrl ?? 'https://api.example.com/v1',
    AI_API_KEY: envOverrides.apiKey ?? 'sk-endpoint-test',
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.log = silentLog();
    next();
  });
  app.use(
    '/api',
    createInsightsRouter({
      authMiddleware: fakeAuth(userId),
      deps: { config, fetchImpl, findInsight: async () => insightDoc ?? null },
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

const INSIGHT_DOC = {
  _id: '64b64b64b64b64b64b64b64b',
  templateId: 'ACTIVITY_MOMENTUM',
  text: 'Commits are up 12% versus the prior period (45 versus 40).',
  metrics: { changePercent: 12.5, currentCommits: 45, priorCommits: 40 },
  evidence: {
    repoIds: ['64b64b64b64b64b64b64b64b'],
    bucketStarts: ['2026-09-01T00:00:00Z'],
    commitShas: ['a'.repeat(40)],
    prNumbers: [42],
  },
  range: '30d',
};

function okProvider(content) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  });
}

describe('POST /api/insights/:id/explain (T6.1)', () => {
  let server;
  let baseUrl;

  before(async () => {
    ({ server, baseUrl } = mountTestRouter({ aiEnabled: false }));
  });
  after(async () => closeServer(server));

  it('returns 501 AI_DISABLED when AI is off (before any DB access)', async () => {
    const res = await fetch(`${baseUrl}/api/insights/64b64b64b64b64b64b64b64b/explain`, { method: 'POST' });
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.equal(body.error.code, 'AI_DISABLED');
  });

  it('returns 401 without authentication (default requireAuth router)', async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, _res, next) => {
      req.log = silentLog();
      next();
    });
    app.use('/api', createInsightsRouter());
    const defaultServer = app.listen(0);
    try {
      const res = await fetch(
        `http://127.0.0.1:${defaultServer.address().port}/api/insights/64b64b64b64b64b64b64b64b/explain`,
        { method: 'POST', headers: { cookie: 'fd_access=garbage' } }
      );
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    } finally {
      await closeServer(defaultServer);
    }
  });
});

describe('POST /api/insights/:id/explain — id safety (AI enabled, no provider needed)', () => {
  it('returns 404 for an unknown insight id', async () => {
    const { server, baseUrl } = mountTestRouter({ aiEnabled: true });
    try {
      const res = await fetch(`${baseUrl}/api/insights/64b64b64b64b64b64b64b640/explain`, { method: 'POST' });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error.code, 'NOT_FOUND');
    } finally {
      await closeServer(server);
    }
  });

  it('returns 404 for a malformed id (no cross-user probing)', async () => {
    const { server, baseUrl } = mountTestRouter({ aiEnabled: true });
    try {
      const res = await fetch(`${baseUrl}/api/insights/not-an-id/explain`, { method: 'POST' });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error.code, 'NOT_FOUND');
    } finally {
      await closeServer(server);
    }
  });
});

describe('POST /api/insights/:id/explain — AI enabled (T6.1)', () => {
  it('returns 200 template text with aiLabel false when no provider is configured', async () => {
    const { server, baseUrl } = mountTestRouter({
      aiEnabled: true,
      insightDoc: INSIGHT_DOC,
      envOverrides: { provider: '', model: '', baseUrl: '', apiKey: '' },
    });
    try {
      const res = await fetch(`${baseUrl}/api/insights/64b64b64b64b64b64b64b64b/explain`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.aiLabel, false);
      assert.equal(body.paraphrase, INSIGHT_DOC.text);
      assert.equal(body.whyItMatters, undefined);
    } finally {
      await closeServer(server);
    }
  });

  it('returns 200 with the validated paraphrase + aiLabel true when the provider succeeds', async () => {
    const { server, baseUrl } = mountTestRouter({
      aiEnabled: true,
      insightDoc: INSIGHT_DOC,
      fetchImpl: okProvider({ paraphrase: 'Commits rose 12% versus 40 in the prior period.' }),
    });
    try {
      const res = await fetch(`${baseUrl}/api/insights/64b64b64b64b64b64b64b64b/explain`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.aiLabel, true);
      assert.equal(body.paraphrase, 'Commits rose 12% versus 40 in the prior period.');
    } finally {
      await closeServer(server);
    }
  });

  it('falls back to template text (aiLabel false) when validation rejects the AI output', async () => {
    const { server, baseUrl } = mountTestRouter({
      aiEnabled: true,
      insightDoc: INSIGHT_DOC,
      fetchImpl: okProvider({ paraphrase: 'You are an expert with 99% mastery.' }),
    });
    try {
      const res = await fetch(`${baseUrl}/api/insights/64b64b64b64b64b64b64b64b/explain`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.aiLabel, false);
      assert.equal(body.paraphrase, INSIGHT_DOC.text);
      // No leaked AI text, no leaked provider payload.
      assert.ok(!JSON.stringify(body).includes('expert'));
    } finally {
      await closeServer(server);
    }
  });

  it('never leaks the provider API key through the endpoint', async () => {
    const { server, baseUrl } = mountTestRouter({
      aiEnabled: true,
      insightDoc: INSIGHT_DOC,
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    try {
      const res = await fetch(`${baseUrl}/api/insights/64b64b64b64b64b64b64b64b/explain`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(!JSON.stringify(body).includes('sk-endpoint-test'));
      assert.equal(body.aiLabel, false);
    } finally {
      await closeServer(server);
    }
  });
});
