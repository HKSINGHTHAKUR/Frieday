/**
 * Google Gemini provider compatibility tests (T6.2 audit).
 *
 * Finding: the native Gemini API (models/{model}:generateContent +
 * x-goog-api-key + candidates[0].content.parts[0].text) is NOT compatible
 * with the OpenAI-shaped llm.explainer. Google's official OpenAI
 * compatibility layer (https://generativelanguage.googleapis.com/v1beta/
 * openai) IS compatible: same route shape, Bearer auth, and choices payload.
 *
 * These tests pin that contract so the Gemini-via-compat configuration is
 * regression-protected: success, malformed response, timeout, retry, and
 * fallback all run through the exact request the production code builds.
 * No production code is changed by this audit.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createAiExplainer } = require('../src/services/ai/explainer.interface');

const GEMINI_COMPAT_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_CONFIG = {
  AI_ENABLED: true,
  AI_PROVIDER: 'gemini',
  AI_MODEL: 'gemini-2.0-flash',
  AI_BASE_URL: GEMINI_COMPAT_BASE,
  AI_API_KEY: 'gemini-api-key-under-test',
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

function geminiResponse(content) {
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

describe('Gemini provider via OpenAI compatibility layer (T6.2 audit)', () => {
  it('sends the documented compat contract: URL, Bearer auth, model, JSON mode', async () => {
    const { calls, impl } = recordingFetch([
      { response: geminiResponse({ paraphrase: 'Commits rose 12%.' }) },
    ]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, true);
    assert.equal(result.paraphrase, 'Commits rose 12%.');
    assert.equal(calls.length, 1);

    const { url, options } = calls[0];
    assert.equal(url, `${GEMINI_COMPAT_BASE}/chat/completions`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${GEMINI_CONFIG.AI_API_KEY}`);

    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gemini-2.0-flash');
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, { type: 'json_object' });
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
    assert.ok(!options.body.includes(GEMINI_CONFIG.AI_API_KEY));
  });

  it('falls back on a malformed Gemini response and keeps the deterministic text', async () => {
    const { impl } = recordingFetch([
      {
        response: {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '<html>not json</html>' } }] }),
        },
      },
    ]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.paraphrase, INPUT.insightText);
    assert.equal(result.fallbackReason, 'PROVIDER_MALFORMED');
  });

  it('retries a transient 429 exactly once, then succeeds', async () => {
    const { calls, impl } = recordingFetch([
      { response: { ok: false, status: 429, json: async () => ({}) } },
      { response: geminiResponse({ paraphrase: 'Commits rose 12%.' }) },
    ]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 2, 'exactly one retry for the transient 429');
    assert.equal(result.aiLabel, true);
    assert.equal(result.paraphrase, 'Commits rose 12%.');
  });

  it('treats an aborted (timeout) request as transient: 1 retry, then fallback', async () => {
    const abort = () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return err;
    };
    const { calls, impl } = recordingFetch([{ error: abort() }, { error: abort() }]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
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
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(calls.length, 2);
    assert.equal(result.aiLabel, false);
    assert.equal(result.paraphrase, INPUT.insightText);
    assert.equal(result.fallbackReason, 'PROVIDER_UNREACHABLE');
    // No provider details leak into the user-facing result.
    assert.ok(!JSON.stringify(result).includes('ECONNREFUSED'));
  });

  it('rejects Gemini output that invents a number or a repository (validator gate)', async () => {
    const injectedNumber = recordingFetch([
      { response: geminiResponse({ paraphrase: 'Commits are up 99% versus 40.' }) },
    ]);
    const explainerNumber = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: injectedNumber.impl });
    const resultNumber = await explainerNumber.explain(INPUT);
    assert.equal(resultNumber.aiLabel, false);
    assert.equal(resultNumber.fallbackReason, 'AI_VALIDATION');

    const injectedRepo = recordingFetch([
      { response: geminiResponse({ paraphrase: 'Activity in someone/unknown-repo rose 12%.' }) },
    ]);
    const explainerRepo = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: injectedRepo.impl });
    const resultRepo = await explainerRepo.explain(INPUT);
    assert.equal(resultRepo.aiLabel, false);
    assert.equal(resultRepo.fallbackReason, 'AI_VALIDATION');
  });
});

describe('Gemini provider error diagnostics (T6.2 audit)', () => {
  const errorResponse = (status, body) => ({
    ok: false,
    status,
    json: async () => body,
  });

  it('400 with Google error body → PROVIDER_REJECTED with status and sanitized details', async () => {
    const { impl } = recordingFetch([
      {
        response: errorResponse(400, {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
          },
        }),
      },
    ]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 400);
    assert.equal(result.fallbackDetails.providerCode, '400');
    assert.ok(result.fallbackDetails.message.includes('API key not valid'));
    // Never leak the API key into the client-visible result
    assert.ok(!JSON.stringify(result).includes(GEMINI_CONFIG.AI_API_KEY));
  });

  it('401 with Google error body → PROVIDER_REJECTED with status and sanitized details', async () => {
    const { impl } = recordingFetch([
      {
        response: errorResponse(401, {
          error: {
            code: 401,
            message: 'Request had invalid authentication credentials.',
            status: 'UNAUTHENTICATED',
          },
        }),
      },
    ]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 401);
    assert.equal(result.fallbackDetails.providerCode, '401');
    assert.ok(result.fallbackDetails.message.includes('authentication'));
    assert.ok(!JSON.stringify(result).includes(GEMINI_CONFIG.AI_API_KEY));
  });

  it('403 quota exceeded → PROVIDER_REJECTED with status and sanitized details', async () => {
    const { impl } = recordingFetch([
      {
        response: errorResponse(403, {
          error: { code: 403, message: 'The API key has no quota remaining.', status: 'PERMISSION_DENIED' },
        }),
      },
    ]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 403);
    assert.equal(result.fallbackDetails.providerCode, '403');
    assert.ok(result.fallbackDetails.message.includes('quota'));
    assert.ok(!JSON.stringify(result).includes(GEMINI_CONFIG.AI_API_KEY));
  });

  it('error body without error field → PROVIDER_REJECTED with status only', async () => {
    const { impl } = recordingFetch([{ response: errorResponse(400, { some: 'random body' }) }]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 400);
    assert.equal(result.fallbackDetails.providerCode, undefined);
    assert.equal(result.fallbackDetails.message, undefined);
  });

  it('non-JSON error body → PROVIDER_REJECTED with status only', async () => {
    const impl = async () => ({
      ok: false,
      status: 400,
      json: async () => {
        throw new Error('not json');
      },
    });
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 400);
    assert.ok(!result.fallbackDetails || result.fallbackDetails.providerCode === undefined);
    assert.ok(!JSON.stringify(result).includes(GEMINI_CONFIG.AI_API_KEY));
  });

  it('OpenAI-format error body → sanitized correctly', async () => {
    const { impl } = recordingFetch([
      {
        response: errorResponse(401, {
          error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 401 },
        }),
      },
    ]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 401);
    assert.equal(result.fallbackDetails.providerCode, '401');
    assert.ok(result.fallbackDetails.message.includes('Incorrect API key provided'));
  });

  it('array-wrapped Google error body → unwrapped and sanitized', async () => {
    const { impl } = recordingFetch([
      {
        response: errorResponse(404, [
          {
            error: {
              code: 404,
              message: 'This model models/gemini-old is no longer available.',
              status: 'NOT_FOUND',
            },
          },
        ]),
      },
    ]);
    const explainer = createAiExplainer({ config: GEMINI_CONFIG, fetchImpl: impl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_REJECTED');
    assert.equal(result.fallbackStatus, 404);
    assert.equal(result.fallbackDetails.providerCode, '404');
    assert.ok(result.fallbackDetails.message.includes('no longer available'));
    assert.ok(!JSON.stringify(result).includes(GEMINI_CONFIG.AI_API_KEY));
  });
});
