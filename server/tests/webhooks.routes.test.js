/**
 * Webhook receiver tests (T7.1) — real Express over HTTP
 * (sync.routes.test.js conventions). Signature computed over the exact raw
 * body bytes with a TEST secret only. Fake delivery store + fake trusted
 * handler count invocations; no live GitHub calls, no MongoDB required.
 *
 * P0 regression proof included: invalid signature → 401 with ZERO store and
 * ZERO handler invocations.
 */
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

const TEST_SECRET = 'hook-secret-for-tests-only';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
// Set BEFORE requiring app modules: getEnv() caches at first call and the
// real-app regression test below needs the webhook configured.
process.env.WEBHOOK_SECRET = TEST_SECRET;

const { createWebhooksRouter } = require('../src/routes/webhooks.routes');

/** HMAC-SHA256 over the exact body string GitHub would sign. */
function sign(body, secret = TEST_SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Counting fakes: delivery ledger + trusted handler boundary. */
function makeFakes() {
  const deliveries = new Set();
  const store = {
    calls: 0,
    async recordDelivery({ deliveryId }) {
      store.calls += 1;
      if (deliveries.has(deliveryId)) return 'duplicate';
      deliveries.add(deliveryId);
      return 'recorded';
    },
  };
  const handler = {
    calls: [],
    async handleEvent(trustedEvent) {
      handler.calls.push(trustedEvent);
      return { queued: false };
    },
  };
  return { store, handler };
}

function mount({ fakes = makeFakes(), config = { WEBHOOK_SECRET: TEST_SECRET } } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {}, error() {} };
    next();
  });
  app.use(
    '/api/webhooks',
    createWebhooksRouter({ deliveryStore: fakes.store, handleEvent: fakes.handler.handleEvent, config })
  );
  const server = app.listen(0);
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, fakes };
}

async function closeServer(server) {
  await new Promise((resolve) => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close(resolve);
  });
}

async function post(baseUrl, { body, event = 'push', delivery = 'd-1', signature } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (event !== null) headers['X-GitHub-Event'] = event;
  if (delivery !== null) headers['X-GitHub-Delivery'] = delivery;
  if (signature !== null) headers['X-Hub-Signature-256'] = signature;
  return fetch(`${baseUrl}/api/webhooks/github`, { method: 'POST', headers, body });
}

const PUSH_BODY = JSON.stringify({
  repository: { id: 1001, full_name: 'tester/app' },
  ref: 'refs/heads/main',
  after: 'abc123',
});
const PR_BODY = JSON.stringify({
  action: 'opened',
  repository: { id: 1001, full_name: 'tester/app' },
  pull_request: { id: 9, number: 42 },
});
const ISSUE_BODY = JSON.stringify({
  action: 'opened',
  repository: { id: 1001, full_name: 'tester/app' },
  issue: { id: 7, number: 5 },
});
const PING_BODY = JSON.stringify({ zen: 'Design for failure.', hook_id: 321 });

describe('POST /api/webhooks/github — signature gate (T7.1)', () => {
  let mounted;
  before(async () => {
    mounted = mount();
  });
  after(async () => closeServer(mounted.server));

  it('accepts a validly signed push and reaches the trusted handler boundary', async () => {
    const res = await post(mounted.baseUrl, {
      body: PUSH_BODY,
      delivery: 'sig-ok-1',
      signature: sign(PUSH_BODY),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { received: true, event: 'push', deduped: false });
    assert.equal(mounted.fakes.handler.calls.length, 1);
    assert.equal(mounted.fakes.handler.calls[0].event, 'push');
    assert.deepEqual(mounted.fakes.handler.calls[0].repository, { id: 1001, full_name: 'tester/app' });
  });

  it('rejects an invalid signature with 401 and ZERO store/handler calls (P0)', async () => {
    const beforeCalls = mounted.fakes.store.calls;
    const beforeHandler = mounted.fakes.handler.calls.length;
    const res = await post(mounted.baseUrl, {
      body: PUSH_BODY,
      delivery: 'sig-bad',
      signature: sign(PUSH_BODY, 'wrong-secret'),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHENTICATED');
    assert.equal(mounted.fakes.store.calls, beforeCalls, 'dedupe store must not be touched');
    assert.equal(mounted.fakes.handler.calls.length, beforeHandler, 'handler must not run');
  });

  it('rejects a missing signature with 401', async () => {
    const res = await post(mounted.baseUrl, { body: PUSH_BODY, delivery: 'sig-missing', signature: null });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'UNAUTHENTICATED');
  });

  it('rejects a malformed signature (wrong prefix) with 401', async () => {
    const res = await post(mounted.baseUrl, {
      body: PUSH_BODY,
      delivery: 'sig-prefix',
      signature: `sha1=${sign(PUSH_BODY).slice(7)}`,
    });
    assert.equal(res.status, 401);
  });

  it('rejects a non-hex signature with 401', async () => {
    const res = await post(mounted.baseUrl, {
      body: PUSH_BODY,
      delivery: 'sig-hex',
      signature: 'sha256=zz-not-hex',
    });
    assert.equal(res.status, 401);
  });

  it('verifies against the exact raw body: modified body with original signature → 401', async () => {
    const tampered = PUSH_BODY.replace('1001', '2002');
    const res = await post(mounted.baseUrl, {
      body: tampered,
      delivery: 'tamper-1',
      signature: sign(PUSH_BODY),
    });
    assert.equal(res.status, 401);
    assert.equal(mounted.fakes.handler.calls.length, 1, 'no handler run for tampered body');
  });

  it('verifies over unusual raw bytes (unicode + whitespace) that re-serialization would break', async () => {
    const raw = '{"repository":{"id":1001,"full_name":"tester/äpp  "},"ref":"refs/heads/main"}';
    const res = await post(mounted.baseUrl, { body: raw, delivery: 'raw-bytes-1', signature: sign(raw) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, event: 'push', deduped: false });
  });

  it('rejects a missing delivery id with 400 (after signature verification)', async () => {
    const res = await post(mounted.baseUrl, { body: PUSH_BODY, delivery: null, signature: sign(PUSH_BODY) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
  });

  it('rejects a missing event header with 400', async () => {
    const res = await post(mounted.baseUrl, {
      body: PUSH_BODY,
      event: null,
      delivery: 'no-event',
      signature: sign(PUSH_BODY),
    });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/webhooks/github — events + dedupe (T7.1)', () => {
  let mounted;
  beforeEach(() => {
    mounted = mount();
  });
  afterEach(async () => {
    await closeServer(mounted.server);
  });

  it('answers a valid ping with pong', async () => {
    const res = await post(mounted.baseUrl, {
      body: PING_BODY,
      event: 'ping',
      delivery: 'ping-1',
      signature: sign(PING_BODY),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, pong: true });
    assert.equal(mounted.fakes.handler.calls.length, 0, 'ping never reaches ingestion');
  });

  it('ignores a signed unknown event without touching the store or handler', async () => {
    const body = JSON.stringify({ anything: true });
    const res = await post(mounted.baseUrl, {
      body,
      event: 'fork',
      delivery: 'fork-1',
      signature: sign(body),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, ignored: true });
    assert.equal(mounted.fakes.store.calls, 0, 'unknown event must not write the dedupe ledger');
    assert.equal(mounted.fakes.handler.calls.length, 0);
  });

  it('routes pull_request and issues to the trusted handler boundary', async () => {
    const prRes = await post(mounted.baseUrl, {
      body: PR_BODY,
      event: 'pull_request',
      delivery: 'pr-1',
      signature: sign(PR_BODY),
    });
    assert.equal(prRes.status, 200);
    assert.equal(mounted.fakes.handler.calls[0].event, 'pull_request');
    assert.equal(mounted.fakes.handler.calls[0].action, 'opened');

    const issueRes = await post(mounted.baseUrl, {
      body: ISSUE_BODY,
      event: 'issues',
      delivery: 'issue-1',
      signature: sign(ISSUE_BODY),
    });
    assert.equal(issueRes.status, 200);
    assert.equal(mounted.fakes.handler.calls[1].event, 'issues');
    assert.equal(mounted.fakes.handler.calls[1].repository.id, 1001);
  });

  it('processes a duplicate delivery only once', async () => {
    const first = await post(mounted.baseUrl, {
      body: PUSH_BODY,
      delivery: 'dup-1',
      signature: sign(PUSH_BODY),
    });
    assert.equal(first.status, 200);
    const second = await post(mounted.baseUrl, {
      body: PUSH_BODY,
      delivery: 'dup-1',
      signature: sign(PUSH_BODY),
    });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { received: true, deduped: true });
    assert.equal(mounted.fakes.handler.calls.length, 1, 'handler ran exactly once');
  });

  it('is race-safe: concurrent duplicate deliveries process once', async () => {
    const [a, b, c] = await Promise.all([
      post(mounted.baseUrl, { body: PUSH_BODY, delivery: 'race-1', signature: sign(PUSH_BODY) }),
      post(mounted.baseUrl, { body: PUSH_BODY, delivery: 'race-1', signature: sign(PUSH_BODY) }),
      post(mounted.baseUrl, { body: PUSH_BODY, delivery: 'race-1', signature: sign(PUSH_BODY) }),
    ]);
    for (const res of [a, b, c]) assert.equal(res.status, 200);
    const bodies = await Promise.all([a.json(), b.json(), c.json()]);
    const accepted = bodies.filter((x) => x.deduped === false);
    const deduped = bodies.filter((x) => x.deduped === true);
    assert.equal(accepted.length, 1, 'exactly one processed');
    assert.equal(deduped.length, 2);
    assert.equal(mounted.fakes.handler.calls.length, 1);
  });

  it('rejects a malformed trusted payload with 400 and no handler call', async () => {
    const broken = JSON.stringify({ repository: { full_name: 'tester/app' } });
    const res = await post(mounted.baseUrl, {
      body: broken,
      event: 'push',
      delivery: 'broken-1',
      signature: sign(broken),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    assert.equal(mounted.fakes.handler.calls.length, 0);
    assert.equal(mounted.fakes.store.calls, 0, 'no dedupe write for a malformed payload');
  });
});

describe('webhook security hygiene (T7.1)', () => {
  it('returns 404 WEBHOOKS_V1 when no secret is configured (disabled, safe)', async () => {
    const { server, baseUrl } = mount({ config: { WEBHOOK_SECRET: '' } });
    try {
      const res = await post(baseUrl, {
        body: PING_BODY,
        event: 'ping',
        delivery: 'disabled-1',
        signature: sign(PING_BODY, ''),
      });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, 'WEBHOOKS_V1');
    } finally {
      await closeServer(server);
    }
  });

  it('never echoes the secret, expected HMAC, or payload in any response', async () => {
    const { server, baseUrl, fakes } = mount();
    try {
      const bad = await post(baseUrl, {
        body: PUSH_BODY,
        delivery: 'leak-1',
        signature: sign(PUSH_BODY, 'wrong'),
      });
      const badBody = JSON.stringify(await bad.json());
      assert.ok(!badBody.includes(TEST_SECRET));
      assert.ok(!badBody.includes(PUSH_BODY));

      await post(baseUrl, { body: PUSH_BODY, delivery: 'leak-2', signature: sign(PUSH_BODY) });
      const okRes = await post(baseUrl, { body: PUSH_BODY, delivery: 'leak-2', signature: sign(PUSH_BODY) });
      const okBody = JSON.stringify(await okRes.json());
      assert.ok(!okBody.includes(TEST_SECRET));
      assert.ok(!okBody.includes(PUSH_BODY));
      assert.equal(fakes.handler.calls.length, 1, 'duplicate delivery must not reprocess');
    } finally {
      await closeServer(server);
    }
  });
});

/**
 * Real-app composition regression (security review fix): the webhook router
 * mounts BEFORE the global JSON parser, so req.id/req.log middleware MUST be
 * attached ahead of it. These tests exercise the actual createApp() stack —
 * a missing middleware would turn every webhook into a 500.
 */
describe('POST /api/webhooks/github — real createApp() composition', () => {
  it('rejects an invalid signature with 401 (not 500) through the full app stack', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': 'real-app-bad-sig',
          'X-Hub-Signature-256': sign(PUSH_BODY, 'wrong-secret'),
        },
        body: PUSH_BODY,
      });
      assert.equal(res.status, 401, 'invalid signature must be 401, never a middleware 500');
      assert.equal((await res.json()).error.code, 'UNAUTHENTICATED');
      assert.ok(res.headers.get('x-request-id'), 'reqId middleware must run for webhook requests');
    } finally {
      await closeServer(server);
    }
  });

  it('accepts a validly signed ping through the real app (200 pong, no 500)', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'ping',
          'X-GitHub-Delivery': 'real-app-ping-1',
          'X-Hub-Signature-256': sign(PING_BODY),
        },
        body: PING_BODY,
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { received: true, pong: true });
    } finally {
      await closeServer(server);
    }
  });
});
