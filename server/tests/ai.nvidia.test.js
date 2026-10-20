/**
 * NVIDIA NIM provider compatibility tests (T6.2 migration).
 *
 * NVIDIA NIM exposes an OpenAI-compatible chat-completions endpoint:
 *   POST https://integrate.api.nvidia.com/v1/chat/completions
 *   Authorization: Bearer <NVIDIA_API_KEY>
 *   Body: { model, messages, temperature, response_format: { type: "json_object" } }
 *
 * These tests pin the NVIDIA NIM contract so the migration from Gemini is
 * regression-protected: success, malformed response, timeout, retry, auth
 * errors, quota errors, and fallback all run through the exact request the
 * production code builds. No live NVIDIA API calls are made — every provider
 * response is mocked.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createAiExplainer } = require('../src/services/ai/explainer.interface');

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_CONFIG = {
  AI_ENABLED: true,
  AI_PROVIDER: 'nvidia',
  NVIDIA_MODEL: 'meta/llama-3.1-8b-instruct',
  NVIDIA_BASE_URL: NVIDIA_BASE,
  NVIDIA_API_KEY: 'nvidia-api-key-under-test',
};

const INPUT = {
  insightTemplateId: 'ACTIVITY_MOMENTUM',
  insightText: 'Commits are up 12% versus the prior period (45 versus 40).',
  metrics: { changePercent: 12.5, currentCommits: 45, priorCommits: 40 },
  evidenceSummary: {
    repoIds: ['64b64b64b64b64b64b64b64b'],
    bucketStarts: ['2026-09-01T00:00:00Z'],
    counts: { repos: 1, commits: 45 },
  },
  timeRange: '30d',
};

function nvidiaResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  };
}

/** Scripted fetch that records every request for contract assertions. */
function recordingFetch(responses) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra provider call');
    if (next.error) throw next.error;
    return next.response;
  };
  return { calls, impl };
}

describe('NVIDIA NIM provider via OpenAI-compatible interface (T6.2 migration)', () => {
  it('sends the documented NIM contract: URL, Bearer auth, model, JSON mode', async () => {
    const { calls, impl } = recordingFetch([
      { response: nvidiaResponse({ paraphrase: 'Commits rose 12%.' }) },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, true);
    assert.equal(result.paraphrase, 'Commits rose 12%.');
    assert.equal(calls.length, 1);

    const { url, options } = calls[0];
    assert.equal(url, `${NVIDIA_BASE}/chat/completions`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${NVIDIA_CONFIG.NVIDIA_API_KEY}`);

    const body = JSON.parse(options.body);
    assert.equal(body.model, 'meta/llama-3.1-8b-instruct');
    assert.equal(body.temperature, 0);
    assert.ok(!('response_format' in body), 'response_format must not be sent to NVIDIA');
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, 'system');
    assert.match(
      body.messages[0].content,
      /Do not invent numbers, repository names, dates, languages, or skills/
    );
    assert.match(body.messages[0].content, /Prompt version: v1/);
    // User payload: the five contract fields as untrusted data — nothing else.
    assert.equal(body.messages[1].role, 'user');
    const dataJson = body.messages[1].content.match(/\{[\s\S]*\}/)[0];
    assert.deepEqual(Object.keys(JSON.parse(dataJson)).sort(), [
      'evidenceSummary',
      'insightTemplateId',
      'insightText',
      'metrics',
      'timeRange',
    ]);
    // The key must ride the auth header only — never the body.
    assert.ok(!options.body.includes(NVIDIA_CONFIG.NVIDIA_API_KEY));
  });

  it('falls back on a malformed NVIDIA response and keeps the deterministic text', async () => {
    const { impl } = recordingFetch([
      {
        response: {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '<html>not json</html>' } }] }),
        },
      },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.paraphrase, INPUT.insightText);
    assert.equal(result.fallbackReason, 'PROVIDER_MALFORMED');
  });

  it('retries a transient 429 exactly with backoff, then succeeds', async () => {
    const { calls, impl } = recordingFetch([
      { response: { ok: false, status: 429, json: async () => ({}) } },
      { response: nvidiaResponse({ paraphrase: 'Commits rose 12%.' }) },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 2, 'exactly one retry for the transient 429');
    assert.equal(result.aiLabel, true);
    assert.equal(result.paraphrase, 'Commits rose 12%.');
  });

  it('respects Retry-After header on 429', async () => {
    const { calls, impl } = recordingFetch([
      {
        response: {
          ok: false,
          status: 429,
          headers: { get: (k) => (k === 'retry-after' ? '2' : undefined) },
          json: async () => ({}),
        },
      },
      { response: nvidiaResponse({ paraphrase: 'Commits rose 12%.' }) },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 2);
    assert.equal(result.aiLabel, true);
    assert.equal(result.paraphrase, 'Commits rose 12%.');
  });

  it('treats an aborted (timeout) request as transient: retry, then fallback', async () => {
    const abort = () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return err;
    };
    const { calls, impl } = recordingFetch([{ error: abort() }, { error: abort() }]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 2);
    assert.equal(result.aiLabel, false);
    assert.equal(result.paraphrase, INPUT.insightText);
    assert.equal(result.fallbackReason, 'PROVIDER_TIMEOUT');
  });

  it('falls back to the deterministic insight on total provider failure', async () => {
    const { calls, impl } = recordingFetch([
      { error: new Error('ECONNREFUSED') },
      { error: new Error('ECONNREFUSED') },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 2);
    assert.equal(result.aiLabel, false);
    assert.equal(result.paraphrase, INPUT.insightText);
    assert.equal(result.fallbackReason, 'PROVIDER_UNREACHABLE');
    assert.ok(!JSON.stringify(result).includes('ECONNREFUSED'));
  });

  it('rejects NVIDIA output that invents a number or a repository (validator gate)', async () => {
    const injectedNumber = recordingFetch([
      { response: nvidiaResponse({ paraphrase: 'Commits are up 99% versus 40.' }) },
    ]);
    const explainerNumber = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: injectedNumber.impl });
    const resultNumber = await explainerNumber.explain(INPUT);
    assert.equal(resultNumber.aiLabel, false);
    assert.equal(resultNumber.fallbackReason, 'AI_VALIDATION');

    const injectedRepo = recordingFetch([
      { response: nvidiaResponse({ paraphrase: 'Activity in someone/unknown-repo rose 12%.' }) },
    ]);
    const explainerRepo = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: injectedRepo.impl });
    const resultRepo = await explainerRepo.explain(INPUT);
    assert.equal(resultRepo.aiLabel, false);
    assert.equal(resultRepo.fallbackReason, 'AI_VALIDATION');
  });
});

describe('NVIDIA NIM provider error diagnostics (T6.2 migration)', () => {
  const errorResponse = (status, body, headers = {}) => ({
    ok: false,
    status,
    headers: { get: (k) => headers[k] },
    json: async () => body,
  });

  it('401 invalid API key → PROVIDER_REJECTED with status and sanitized details', async () => {
    const { impl } = recordingFetch([
      {
        response: errorResponse(401, {
          error: { message: 'Invalid API key.', type: 'invalid_request_error', code: 401 },
        }),
      },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 401);
    assert.equal(result.fallbackDetails.providerCode, '401');
    assert.ok(result.fallbackDetails.message.includes('Invalid API key'));
    assert.ok(!JSON.stringify(result).includes(NVIDIA_CONFIG.NVIDIA_API_KEY));
  });

  it('403 access denied → PROVIDER_REJECTED with status and sanitized details', async () => {
    const { impl } = recordingFetch([
      {
        response: errorResponse(403, {
          error: { message: 'Access denied to this model.', type: 'insufficient_quota', code: 403 },
        }),
      },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 403);
    assert.equal(result.fallbackDetails.providerCode, '403');
    assert.ok(result.fallbackDetails.message.includes('Access denied'));
    assert.ok(!JSON.stringify(result).includes(NVIDIA_CONFIG.NVIDIA_API_KEY));
  });

  it('404 model not found → PROVIDER_REJECTED with status and sanitized details', async () => {
    const { impl } = recordingFetch([
      {
        response: errorResponse(404, {
          error: { message: 'The model meta/nonexistent is not available.', code: 404 },
        }),
      },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 404);
    assert.equal(result.fallbackDetails.providerCode, '404');
    assert.ok(result.fallbackDetails.message.includes('not available'));
    assert.ok(!JSON.stringify(result).includes(NVIDIA_CONFIG.NVIDIA_API_KEY));
  });

  it('410 Gone (NVIDIA detail format) → PROVIDER_REJECTED, no retry, sanitized diagnostic', async () => {
    const { calls, impl } = recordingFetch([
      {
        response: errorResponse(410, {
          type: 'urn:nvcf-worker-service:problem-details:resource-gone',
          title: 'Resource Gone',
          status: 410,
          detail: 'The model meta/llama-3.1-8b-instruct is no longer available at this endpoint.',
          instance: '/v2/nvcf/pexec/functions/abc123',
          requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        }),
      },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    // 410 is not transient → no retry, exactly 1 call
    assert.equal(calls.length, 1, 'HTTP 410 must not be retried');
    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 410);
    assert.equal(result.fallbackDetails.providerCode, '410');
    assert.ok(
      result.fallbackDetails.message.includes('no longer available'),
      'NVIDIA detail field must be extracted'
    );
    assert.ok(!JSON.stringify(result).includes(NVIDIA_CONFIG.NVIDIA_API_KEY), 'API key must not leak');
  });

  it('410 with empty body → PROVIDER_REJECTED with status only, no crash', async () => {
    const { calls, impl } = recordingFetch([
      {
        response: { ok: false, status: 410, headers: {}, json: async () => null },
      },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 1, 'no retry on 410');
    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 410);
    assert.equal(result.fallbackDetails.providerCode, undefined);
    assert.equal(result.fallbackDetails.message, undefined);
    assert.ok(!JSON.stringify(result).includes(NVIDIA_CONFIG.NVIDIA_API_KEY));
  });

  it('request body sent to NVIDIA does NOT include response_format', async () => {
    const { calls, impl } = recordingFetch([
      { response: nvidiaResponse({ paraphrase: 'Commits rose 12%.' }) },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, true);
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].options.body);
    assert.ok(
      !('response_format' in body),
      'response_format must not be sent to NVIDIA (additionalProperties: false)'
    );
    assert.equal(body.model, 'meta/llama-3.1-8b-instruct');
    assert.ok(Array.isArray(body.messages));
    assert.ok(body.messages.length > 0);
  });

  it('503 transient → PROVIDER_TRANSIENT with retry, then succeeds', async () => {
    const { calls, impl } = recordingFetch([
      { response: errorResponse(503, { error: { message: 'Service unavailable.', code: 503 } }) },
      { response: nvidiaResponse({ paraphrase: 'Commits rose 12%.' }) },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 2, 'initial + 1 retry for transient 503');
    assert.equal(result.aiLabel, true);
    assert.equal(result.paraphrase, 'Commits rose 12%.');
  });

  it('503 exhausting retry budget → fallback', async () => {
    const { calls, impl } = recordingFetch([
      { response: errorResponse(503, { error: { message: 'Service unavailable.', code: 503 } }) },
      { response: errorResponse(503, { error: { message: 'Service unavailable.', code: 503 } }) },
    ]);
    const explainer = createAiExplainer({ config: NVIDIA_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 2, 'all attempts exhausted');
    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_TRANSIENT');
    assert.equal(result.paraphrase, INPUT.insightText);
  });

  it('missing NVIDIA_API_KEY → AI_CONFIG fallback', async () => {
    const explainer = createAiExplainer({
      config: { ...NVIDIA_CONFIG, NVIDIA_API_KEY: '' },
      fetchImpl: async () => {
        throw new Error('must not be called');
      },
    });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'AI_CONFIG');
    assert.equal(result.paraphrase, INPUT.insightText);
  });

  it('missing NVIDIA_MODEL → AI_CONFIG fallback', async () => {
    const explainer = createAiExplainer({
      config: { ...NVIDIA_CONFIG, NVIDIA_MODEL: '' },
      fetchImpl: async () => {
        throw new Error('must not be called');
      },
    });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'AI_CONFIG');
  });

  it('AI_ENABLED=false → TemplateExplainer fallback, no provider call', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      throw new Error('must not be called');
    };
    const explainer = createAiExplainer({ config: { ...NVIDIA_CONFIG, AI_ENABLED: false }, fetchImpl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.paraphrase, INPUT.insightText);
    assert.equal(calls, 0);
  });

  it('no secrets leak into fallback reason or result', async () => {
    const secret = 'nvidia-api-key-under-test';
    const fetchImpl = async () => {
      throw new Error('connection refused');
    };
    const explainer = createAiExplainer({
      config: { ...NVIDIA_CONFIG, NVIDIA_API_KEY: secret },
      fetchImpl,
    });
    const result = await explainer.explain(INPUT);

    assert.ok(!JSON.stringify(result).includes(secret), 'API key must not appear in result');
    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_UNREACHABLE');
  });
});
