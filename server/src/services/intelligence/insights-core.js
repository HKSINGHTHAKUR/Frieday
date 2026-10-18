/**
 * Insight templates core (T4.3) — constants, utilities, and main evaluation entry.
 *
 * Pure: no I/O, no DB access, no network calls, no wall-clock, no randomness.
 */

// Fixed template priority order (F8 order from PRD §9)
const TEMPLATE_PRIORITY = [
  'ACTIVITY_MOMENTUM',
  'FOCUS_SHIFT',
  'REPOSITORY_CONCENTRATION',
  'CONSISTENCY',
  'REVIEW_CONTRIBUTION',
  'PROJECT_HEALTH',
  'LANGUAGE_MIX_CHANGE',
  'QUIET_PERIOD',
];

const MAX_INSIGHTS = 8;

/**
 * Template IDs - must match the Insight model's expected templateId values.
 */
const TEMPLATE_IDS = {
  ACTIVITY_MOMENTUM: 'activity_momentum',
  FOCUS_SHIFT: 'focus_shift',
  REPOSITORY_CONCENTRATION: 'repository_concentration',
  CONSISTENCY: 'consistency',
  REVIEW_CONTRIBUTION: 'review_contribution',
  PROJECT_HEALTH: 'project_health',
  LANGUAGE_MIX_CHANGE: 'language_mix_change',
  QUIET_PERIOD: 'quiet_period',
};

/**
 * Confidence levels from T4.1/T4.2
 */
const CONFIDENCE = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

/**
 * Build evidence object from raw references.
 * Only includes fields that have non-empty values.
 */
function buildEvidence({ repoIds = [], commitShas = [], prNumbers = [], bucketStarts = [] }) {
  const evidence = {};
  if (repoIds.length) evidence.repoIds = repoIds;
  if (commitShas.length) evidence.commitShas = commitShas;
  if (prNumbers.length) evidence.prNumbers = prNumbers;
  if (bucketStarts.length) evidence.bucketStarts = bucketStarts;
  return evidence;
}

/**
 * Determine confidence based on sample size and data quality.
 * Uses T4.1/T4.2 confidence semantics.
 */
function computeInsightConfidence({ sampleSize = 0, repoCount = 0, hasValidDelta = true }) {
  if (!hasValidDelta) return CONFIDENCE.LOW;
  if (sampleSize >= 10 && repoCount >= 2) return CONFIDENCE.HIGH;
  if (sampleSize >= 5) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

// eslint-disable-next-line no-unused-vars
const _unusedExports = {
  TEMPLATE_PRIORITY,
  TEMPLATE_IDS,
  MAX_INSIGHTS,
  CONFIDENCE,
  buildEvidence,
  computeInsightConfidence,
};

module.exports = {
  TEMPLATE_PRIORITY,
  TEMPLATE_IDS,
  MAX_INSIGHTS,
  CONFIDENCE,
  buildEvidence,
  computeInsightConfidence,
};
