/**
 * TemplateExplainer (T6.1, prd.md §19) — the MVP default and graceful
 * degradation baseline. No external provider, no invented facts: the
 * deterministic insight text IS the paraphrase. whyItMatters is omitted
 * because no safe deterministic explanation exists in the stored insight.
 */

/**
 * Contract-compliant fallback explanation.
 * @param {{ insightText: string }} insightInput strict AI contract input
 * @returns {{ paraphrase: string, aiLabel: boolean }}
 */
function templateExplain(insightInput) {
  return { paraphrase: insightInput.insightText, aiLabel: false };
}

module.exports = { templateExplain };
