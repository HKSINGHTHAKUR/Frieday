/**
 * AI provider contract and configuration validation tests (Item 2, Phase 9).
 *
 * Covers gaps not exercised by the existing AI-layer suites:
 * - providerConfig() returns null for incomplete config (missing model, base URL, API key)
 * - providerConfig() accepts complete config
 * - Empty provider content → malformed error → fallback
 * - 429/5xx exhausting the retry budget → fallback
 * - Missing AI_API_KEY in env is not treated as configured
 * - Configuration validation test: AI_ENABLED=true without provider vars → graceful fallback
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { providerConfig, AiError, providerConfigDiagnostic } = require('../src/services/ai/llm.explainer');
const { createAiExplainer } = require('../src/services/ai/explainer.interface');

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

const COMPLETE_CONFIG = {
  AI_ENABLED: true,
  AI_PROVIDER: 'openai',
  AI_MODEL: 'gpt-4o-mini',
  AI_BASE_URL: 'https://api.example.com/v1',
  AI_API_KEY: 'sk-test-key-12345',
};

describe('ai/llm.explainer providerConfig (Item 2)', () => {
  it('returns null when model is missing', () => {
    const result = providerConfig({ ...COMPLETE_CONFIG, AI_MODEL: '' });
    assert.equal(result, null);
  });

  it('returns null when base URL is missing', () => {
    const result = providerConfig({ ...COMPLETE_CONFIG, AI_BASE_URL: '' });
    assert.equal(result, null);
  });

  it('returns null when API key is missing', () => {
    const result = providerConfig({ ...COMPLETE_CONFIG, AI_API_KEY: '' });
    assert.equal(result, null);
  });

  it('returns null when all provider fields are empty', () => {
    const result = providerConfig({
      AI_ENABLED: true,
      AI_PROVIDER: '',
      AI_MODEL: '',
      AI_BASE_URL: '',
      AI_API_KEY: '',
    });
    assert.equal(result, null);
  });

  it('returns a resolved config when all fields are present', () => {
    const result = providerConfig(COMPLETE_CONFIG);
    assert.ok(result);
    assert.equal(result.model, 'gpt-4o-mini');
    assert.equal(result.baseUrl, 'https://api.example.com/v1');
    assert.equal(result.apiKey, 'sk-test-key-12345');
  });

  it('strips trailing slash from base URL', () => {
    const result = providerConfig({ ...COMPLETE_CONFIG, AI_BASE_URL: 'https://api.example.com/v1/' });
    assert.equal(result.baseUrl, 'https://api.example.com/v1');
  });

  it('AiError carries code, message, and retryable flag', () => {
    const err = new AiError({ code: 'TEST_CODE', message: 'test message', retryable: true });
    assert.equal(err.name, 'AiError');
    assert.equal(err.code, 'TEST_CODE');
    assert.equal(err.message, 'test message');
    assert.equal(err.retryable, true);
  });
});

describe('ai provider contract: empty/malformed content (Item 2)', () => {
  it('empty content string → PROVIDER_MALFORMED → fallback', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    });
    const explainer = createAiExplainer({ config: COMPLETE_CONFIG, fetchImpl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.paraphrase, INPUT.insightText);
    assert.equal(result.fallbackReason, 'PROVIDER_MALFORMED');
  });

  it('missing choices array → PROVIDER_MALFORMED → fallback', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const explainer = createAiExplainer({ config: COMPLETE_CONFIG, fetchImpl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_MALFORMED');
  });

  it('choices[0].message.content missing → PROVIDER_MALFORMED → fallback', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: {} }] }),
    });
    const explainer = createAiExplainer({ config: COMPLETE_CONFIG, fetchImpl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_MALFORMED');
  });
});

describe('ai provider contract: transient failure exhausting retry budget (Item 2)', () => {
  it('429 on both attempts → fallback after budget exhausted', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      return { ok: false, status: 429, json: async () => ({}) };
    };
    const explainer = createAiExplainer({ config: COMPLETE_CONFIG, fetchImpl });
    const result = await explainer.explain(INPUT);

    assert.equal(attempts, 2, 'exactly 2 attempts (initial + 1 retry)');
    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_TRANSIENT');
  });

  it('500 on both attempts → fallback after budget exhausted', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const explainer = createAiExplainer({ config: COMPLETE_CONFIG, fetchImpl });
    const result = await explainer.explain(INPUT);

    assert.equal(attempts, 2);
    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_TRANSIENT');
  });

  it('408 on first, success on second → passes after one retry', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 408, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ paraphrase: 'Commits rose 12%.' }) } }],
        }),
      };
    };
    const explainer = createAiExplainer({ config: COMPLETE_CONFIG, fetchImpl });
    const result = await explainer.explain(INPUT);

    assert.equal(attempts, 2);
    assert.equal(result.aiLabel, true);
    assert.equal(result.paraphrase, 'Commits rose 12%.');
  });
});

describe('ai configuration validation (Item 2)', () => {
  it('AI_ENABLED=true with no provider vars → TemplateExplainer fallback with AI_CONFIG', async () => {
    const fetchImpl = async () => {
      throw new Error('must not be called');
    };
    const explainer = createAiExplainer({
      config: { AI_ENABLED: true, AI_PROVIDER: '', AI_MODEL: '', AI_BASE_URL: '', AI_API_KEY: '' },
      fetchImpl,
    });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(result.paraphrase, INPUT.insightText);
    assert.equal(result.fallbackReason, 'AI_CONFIG');
  });

  it('AI disabled → never calls provider, no config needed', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      throw new Error('must not be called');
    };
    const explainer = createAiExplainer({ config: { AI_ENABLED: false }, fetchImpl });
    const result = await explainer.explain(INPUT);

    assert.equal(result.aiLabel, false);
    assert.equal(calls, 0);
  });

  it('no secrets leak into fallback reason or result', async () => {
    const secret = 'sk-live-secret-key-do-not-log';
    const fetchImpl = async () => {
      throw new Error('connection refused');
    };
    const explainer = createAiExplainer({
      config: { ...COMPLETE_CONFIG, AI_API_KEY: secret },
      fetchImpl,
    });
    const result = await explainer.explain(INPUT);

    assert.ok(!JSON.stringify(result).includes(secret), 'API key must not appear in result');
    assert.equal(result.aiLabel, false);
    assert.equal(result.fallbackReason, 'PROVIDER_UNREACHABLE');
  });
});

describe('providerConfig: NVIDIA var selection (regression — GitHub issue: AI_CONFIG with nvidia provider)', () => {
  const NVIDIA_COMPLETE = {
    AI_ENABLED: true,
    AI_PROVIDER: 'nvidia',
    NVIDIA_MODEL: 'meta/llama-3.1-8b-instruct',
    NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1',
    NVIDIA_API_KEY: 'nvidia-test-key',
  };

  it('AI_PROVIDER=nvidia resolves using NVIDIA_API_KEY/NVIDIA_MODEL/NVIDIA_BASE_URL', () => {
    const result = providerConfig(NVIDIA_COMPLETE);
    assert.ok(result, 'providerConfig should return a config when all NVIDIA vars are present');
    assert.equal(result.model, 'meta/llama-3.1-8b-instruct');
    assert.equal(result.baseUrl, 'https://integrate.api.nvidia.com/v1');
    assert.equal(result.apiKey, 'nvidia-test-key');
  });

  it('AI_PROVIDER=nvidia returns null when NVIDIA_MODEL is missing (even if AI_MODEL is set)', () => {
    const result = providerConfig({
      ...NVIDIA_COMPLETE,
      NVIDIA_MODEL: '',
      AI_MODEL: 'gpt-4o-mini', // generic var should NOT be used when provider=nvidia
    });
    assert.equal(result, null, 'providerConfig should return null when NVIDIA_MODEL is missing');
  });

  it('AI_PROVIDER=nvidia returns null when NVIDIA_BASE_URL is missing', () => {
    const result = providerConfig({
      ...NVIDIA_COMPLETE,
      NVIDIA_BASE_URL: '',
    });
    assert.equal(result, null, 'providerConfig should return null when NVIDIA_BASE_URL is missing');
  });

  it('AI_PROVIDER=nvidia returns null when NVIDIA_API_KEY is missing', () => {
    const result = providerConfig({
      ...NVIDIA_COMPLETE,
      NVIDIA_API_KEY: '',
    });
    assert.equal(result, null, 'providerConfig should return null when NVIDIA_API_KEY is missing');
  });

  it('AI_PROVIDER=nvidia falls back to generic AI_* vars when NVIDIA vars not set', () => {
    const result = providerConfig({
      AI_ENABLED: true,
      AI_PROVIDER: 'nvidia',
      AI_MODEL: 'gpt-4o-mini',
      AI_BASE_URL: 'https://api.example.com/v1',
      AI_API_KEY: 'sk-test-key',
    });
    assert.ok(result, 'should fall back to generic AI_* vars');
    assert.equal(result.model, 'gpt-4o-mini');
    assert.equal(result.baseUrl, 'https://api.example.com/v1');
    assert.equal(result.apiKey, 'sk-test-key');
  });

  it('providerConfigDiagnostic reports presence booleans without leaking the API key', () => {
    const diag = providerConfigDiagnostic(NVIDIA_COMPLETE);
    assert.equal(diag.provider, 'nvidia');
    assert.equal(diag.aiEnabled, true);
    assert.equal(diag.modelPresent, true);
    assert.equal(diag.baseUrlPresent, true);
    assert.equal(diag.apiKeyPresent, true);
    assert.equal(diag.resolvedModel, 'meta/llama-3.1-8b-instruct');
    assert.equal(diag.resolvedBaseUrl, 'https://integrate.api.nvidia.com/v1');
    assert.equal(diag.providerConfigured, true);
    // Never leak the key
    assert.ok(!JSON.stringify(diag).includes('nvidia-test-key'));
  });

  it('providerConfigDiagnostic reports missing NVIDIA vars as absent', () => {
    const diag = providerConfigDiagnostic({
      AI_ENABLED: true,
      AI_PROVIDER: 'nvidia',
      NVIDIA_MODEL: '',
      NVIDIA_BASE_URL: '',
      NVIDIA_API_KEY: '',
    });
    assert.equal(diag.provider, 'nvidia');
    assert.equal(diag.modelPresent, false);
    assert.equal(diag.baseUrlPresent, false);
    assert.equal(diag.apiKeyPresent, false);
    assert.equal(diag.resolvedModel, null);
    assert.equal(diag.resolvedBaseUrl, null);
    assert.equal(diag.providerConfigured, false);
  });
});
