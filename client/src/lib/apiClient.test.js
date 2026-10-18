/**
 * apiClient 401/refresh contract tests (tasks.md T1.3).
 * Runs under Node's built-in test runner (client "test" script) — no browser
 * needed: fetch is injected, and the default browser bindings are never used.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from './apiClient.js';

const UNAUTH = {
  status: 401,
  json: { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.', retryable: false } },
};
const OK = { status: 200, json: { ok: true } };

/**
 * @param {Array<{ status: number, json?: unknown }>} responses
 * @param {{ calls: Array<{ url: string, init: object }>, storageCalls: string[] }} ctx
 */
function makeFetch(responses, ctx) {
  return async (url, init) => {
    ctx.calls.push({ url, init });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: async () => next.json,
      text: async () => JSON.stringify(next.json ?? ''),
    };
  };
}

describe('apiClient base contract', () => {
  it('returns parsed JSON on 200', async () => {
    const ctx = { calls: [], storageCalls: [] };
    const client = createApiClient({ fetchImpl: makeFetch([OK], ctx) });
    await assert.deepEqual(await client.apiGet('/api/health'), { ok: true });
    assert.equal(ctx.calls[0].init.credentials, 'include', 'cookies must travel with every request');
  });

  it('returns null for 204', async () => {
    const ctx = { calls: [], storageCalls: [] };
    const client = createApiClient({ fetchImpl: makeFetch([{ status: 204 }], ctx) });
    assert.equal(await client.apiPost('/api/auth/logout'), null);
  });

  it('throws NETWORK_ERROR (retryable) when the server is unreachable', async () => {
    const failing = async () => {
      throw new TypeError('fetch failed');
    };
    const client = createApiClient({ fetchImpl: failing });
    await assert.rejects(client.apiGet('/api/health'), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'NETWORK_ERROR');
      assert.equal(err.retryable, true);
      return true;
    });
  });

  it('throws a typed ApiError for other non-2xx responses', async () => {
    const ctx = { calls: [], storageCalls: [] };
    const client = createApiClient({
      fetchImpl: makeFetch(
        [{ status: 503, json: { error: { code: 'INTERNAL', message: 'down', retryable: true } } }],
        ctx
      ),
    });
    await assert.rejects(client.apiGet('/api/health'), (err) => {
      assert.equal(err.code, 'INTERNAL');
      assert.equal(err.status, 503);
      assert.equal(err.retryable, true);
      return true;
    });
  });
});

describe('apiClient 401 + session rotation (T1.3)', () => {
  it('rotates once on UNAUTHENTICATED and retries the original request', async () => {
    const ctx = { calls: [], storageCalls: [] };
    let refresherCalls = 0;
    const client = createApiClient({
      fetchImpl: makeFetch([UNAUTH, OK], ctx),
      refresher: async () => {
        refresherCalls += 1;
        return true;
      },
    });
    await assert.deepEqual(await client.apiGet('/api/dashboard'), { ok: true });
    assert.equal(refresherCalls, 1, 'the session must be rotated exactly once');
    assert.equal(ctx.calls.length, 2, 'the original request must be retried exactly once');
    assert.equal(ctx.calls[1].url, '/api/dashboard');
  });

  it('propagates the original 401 and does not retry when rotation fails', async () => {
    const ctx = { calls: [], storageCalls: [] };
    const client = createApiClient({
      fetchImpl: makeFetch([UNAUTH], ctx),
      refresher: async () => false,
    });
    await assert.rejects(client.apiGet('/api/dashboard'), (err) => {
      assert.equal(err.code, 'UNAUTHENTICATED');
      assert.equal(err.status, 401);
      return true;
    });
    assert.equal(ctx.calls.length, 1, 'no retry after a failed rotation');
  });

  it('never auto-refreshes on the auth endpoints themselves', async () => {
    for (const path of ['/api/auth/refresh', '/api/auth/logout', '/api/auth/disconnect']) {
      const ctx = { calls: [], storageCalls: [] };
      let refresherCalls = 0;
      const client = createApiClient({
        fetchImpl: makeFetch([UNAUTH], ctx),
        refresher: async () => {
          refresherCalls += 1;
          return true;
        },
      });
      await assert.rejects(client.apiPost(path));
      assert.equal(refresherCalls, 0, `${path} must not trigger auto-refresh`);
      assert.equal(ctx.calls.length, 1);
    }
  });

  it('does not refresh on a 401 with a non-UNAUTHENTICATED code', async () => {
    const ctx = { calls: [], storageCalls: [] };
    let refresherCalls = 0;
    const client = createApiClient({
      fetchImpl: makeFetch(
        [{ status: 401, json: { error: { code: 'FORBIDDEN', message: 'nope', retryable: false } } }],
        ctx
      ),
      refresher: async () => {
        refresherCalls += 1;
        return true;
      },
    });
    await assert.rejects(client.apiGet('/api/dashboard'));
    assert.equal(refresherCalls, 0);
  });

  it('throws (not crashes) when no refresher is registered', async () => {
    const ctx = { calls: [], storageCalls: [] };
    const client = createApiClient({ fetchImpl: makeFetch([UNAUTH], ctx) });
    await assert.rejects(client.apiGet('/api/dashboard'), (err) => err.code === 'UNAUTHENTICATED');
  });

  it('retries every concurrently-failed request once the rotation resolves', async () => {
    const ctx = { calls: [], storageCalls: [] };
    const pendingResolvers = [];
    const client = createApiClient({
      fetchImpl: makeFetch([UNAUTH, UNAUTH, OK, OK], ctx),
      refresher: () => new Promise((resolve) => pendingResolvers.push(resolve)),
    });
    const p1 = client.apiGet('/api/dashboard');
    const p2 = client.apiGet('/api/repos');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ctx.calls.length, 2, 'both originals sent');
    assert.equal(
      pendingResolvers.length,
      2,
      'each failed request requests a rotation (the store single-flights it)'
    );
    pendingResolvers.forEach((resolve) => resolve(true));
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepEqual(r1, { ok: true });
    assert.deepEqual(r2, { ok: true });
    assert.equal(ctx.calls.length, 4, 'two originals + two retries');
  });

  it('never touches localStorage or sessionStorage (token storage ban)', async () => {
    const setSpy = (label) => () => {
      ctx.storageCalls.push(label);
    };
    const ctx = { calls: [], storageCalls: [] };
    globalThis.localStorage = {
      setItem: setSpy('localStorage'),
      getItem: () => null,
      removeItem: setSpy('localStorage-rm'),
    };
    globalThis.sessionStorage = {
      setItem: setSpy('sessionStorage'),
      getItem: () => null,
      removeItem: setSpy('sessionStorage-rm'),
    };
    try {
      const client = createApiClient({
        fetchImpl: makeFetch([UNAUTH, OK], ctx),
        refresher: async () => true,
      });
      await client.apiGet('/api/dashboard');
      assert.deepEqual(ctx.storageCalls, [], 'auth state must never be persisted client-side');
    } finally {
      delete globalThis.localStorage;
      delete globalThis.sessionStorage;
    }
  });
});
