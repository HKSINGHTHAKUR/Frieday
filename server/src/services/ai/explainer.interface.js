/**
 * AIExplainer interface (T6.1, prd.md §19, architecture.md §11).
 *
 * Contract: explain(insightInput) → Promise<{ paraphrase, whyItMatters?, aiLabel }>.
 * Selection: AI disabled (default) → TemplateExplainer; enabled → LlmExplainer
 * with any failure (config, provider, timeout, validation) falling back to
 * template text. AI failure must never break insight availability.
 *
 * The input is the strict contract — buildInsightInput strips everything
 * else (raw commit messages, issue titles, PR descriptions, tokens, whole
 * documents) before anything reaches the prompt.
 */

const { templateExplain } = require('./template.explainer');
const { createLlmExplainer } = require('./llm.explainer');

const CONTRACT_FIELDS = ['insightTemplateId', 'insightText', 'metrics', 'evidenceSummary', 'timeRange'];

/**
 * Reduce arbitrary data to the exact AI contract input. Unknown fields
 * (rawCommitMessage, issueTitle, token, …) are dropped, not passed through.
 * @param {unknown} raw candidate input
 * @returns {{ insightTemplateId: string, insightText: string, metrics: object, evidenceSummary: object, timeRange: string } | null}
 */
function buildInsightInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const input = {};
  input.insightTemplateId = typeof raw.insightTemplateId === 'string' ? raw.insightTemplateId : '';
  input.insightText = typeof raw.insightText === 'string' ? raw.insightText : '';
  input.metrics = isPlainObject(raw.metrics) ? raw.metrics : {};
  input.evidenceSummary = isPlainObject(raw.evidenceSummary) ? raw.evidenceSummary : {};
  input.timeRange = typeof raw.timeRange === 'string' ? raw.timeRange : '';
  const requiredPresent = input.insightTemplateId.length > 0 && input.insightText.length > 0;
  return requiredPresent ? input : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {{ config: object, fetchImpl?: typeof fetch, timeoutMs?: number }} [deps]
 *        config defaults to the validated env (getEnv()).
 */
function createAiExplainer(deps = {}) {
  const config = deps.config ?? require('../../config/env').getEnv();

  return {
    /** @returns {Promise<{ paraphrase: string, whyItMatters?: string, aiLabel: boolean, fallbackReason?: string }>} */
    async explain(insightInput) {
      if (!config.AI_ENABLED) {
        return templateExplain(insightInput);
      }
      const llm = createLlmExplainer({ config, fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs });
      try {
        return await llm.explain(insightInput);
      } catch (err) {
        // Graceful degradation (prd.md §19): fall back to the deterministic
        // text. fallbackReason is internal observability, stripped by routes.
        // Never log or return provider credentials, full env, or user data.
        return {
          ...templateExplain(insightInput),
          fallbackReason: (err && err.code) || 'PROVIDER_ERROR',
          fallbackStatus: (err && err.status) ?? null,
          fallbackDetails: (err && err.details) ?? null,
        };
      }
    },
  };
}

module.exports = { createAiExplainer, buildInsightInput, CONTRACT_FIELDS };
