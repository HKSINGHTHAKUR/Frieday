/**
 * Insight templates (T4.3) — deterministic template evaluation engine.
 *
 * Implements the 8 PRD §18 F8 templates with fixed priority, max 8 insights,
 * evidence-backed outputs, and confidence semantics from T4.1/T4.2.
 *
 * Pure: no I/O, no DB access, no network calls, no wall-clock, no randomness.
 * All functions accept explicit inputs and return deterministic outputs.
 */

const {
  INSIGHT_VERSION, // eslint-disable-line no-unused-vars
  TEMPLATE_PRIORITY, // eslint-disable-line no-unused-vars
  TEMPLATE_IDS, // eslint-disable-line no-unused-vars
  MAX_INSIGHTS, // eslint-disable-line no-unused-vars
  CONFIDENCE, // eslint-disable-line no-unused-vars
  buildEvidence, // eslint-disable-line no-unused-vars
  computeInsightConfidence, // eslint-disable-line no-unused-vars
} = require('./insights-core');

const { evaluateActivityMomentum, evaluateFocusShift } = require('./insights-activity-focus');
const { evaluateRepositoryConcentration, evaluateConsistency } = require('./insights-repo-consistency');
const { evaluateReviewContribution, evaluateProjectHealth } = require('./insights-contrib-health');
const { evaluateLanguageMixChange, evaluateQuietPeriod } = require('./insights-lang-quiet');

/**
 * Main evaluation function - runs all 8 templates in fixed priority order.
 * Returns up to MAX_INSIGHTS insights, suppressing null results.
 */
function evaluateInsights({
  // Current period data
  commits = [],
  pullRequests = [],
  issues = [],
  repositories = [],
  timeline = [],
  languages = { weightedBytes: {}, commitShare: {} },
  focus = [],
  consistency = { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
  repoHealth = [],
  // Previous period data (for comparison templates)
  previousCommits = [],
  previousPullRequests = [],
  previousIssues = [],
  previousRepositories = [],
  previousTimeline = [],
  previousLanguages = { weightedBytes: {}, commitShare: {} },
  previousFocus = [],
  previousConsistency = { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
  previousRepoHealth = [],
  // Metadata
  range = '30d',
  anchor = new Date(),
} = {}) {
  const current = {
    timeline,
    languages,
    focus,
    consistency,
    repoHealth,
    commits,
    pullRequests,
    issues,
    repositories,
  };

  const previous = {
    timeline: previousTimeline,
    languages: previousLanguages,
    focus: previousFocus,
    consistency: previousConsistency,
    repoHealth: previousRepoHealth,
    commits: previousCommits,
    pullRequests: previousPullRequests,
    issues: previousIssues,
    repositories: previousRepositories,
  };

  const insights = [];

  // Template 1: Activity Momentum
  const momentum = evaluateActivityMomentum({ current, previous, range, anchor });
  if (momentum) insights.push(momentum);

  // Template 2: Focus Shift
  const focusShift = evaluateFocusShift({ current, previous });
  if (focusShift) insights.push(focusShift);

  // Template 3: Repository Concentration
  const concentration = evaluateRepositoryConcentration({ commits, repositories, timeline });
  if (concentration) insights.push(concentration);

  // Template 4: Consistency
  const consistencyInsight = evaluateConsistency({ consistency, range });
  if (consistencyInsight) insights.push(consistencyInsight);

  // Template 5: Review Contribution
  const review = evaluateReviewContribution({ pullRequests });
  if (review) insights.push(review);

  // Template 6: Project Health
  const healthInsights = evaluateProjectHealth({ repoHealth, previousRepoHealth });
  insights.push(...healthInsights);

  // Template 7: Language Mix Change
  const langChange = evaluateLanguageMixChange({
    current: { languages },
    previous: { languages: previousLanguages },
  });
  if (langChange) insights.push(langChange);

  // Template 8: Quiet Period
  const quiet = evaluateQuietPeriod({ consistency });
  if (quiet) insights.push(quiet);

  // Apply fixed priority ordering
  const priorityMap = Object.fromEntries(
    [
      'ACTIVITY_MOMENTUM',
      'FOCUS_SHIFT',
      'REPOSITORY_CONCENTRATION',
      'CONSISTENCY',
      'REVIEW_CONTRIBUTION',
      'PROJECT_HEALTH',
      'LANGUAGE_MIX_CHANGE',
      'QUIET_PERIOD',
    ].map((id, idx) => [id, idx])
  );
  insights.sort((a, b) => {
    const pa = priorityMap[a.templateId] ?? 999;
    const pb = priorityMap[b.templateId] ?? 999;
    return pa - pb;
  });

  // Cap at MAX_INSIGHTS
  return insights.slice(0, 8);
}

module.exports = {
  INSIGHT_VERSION: 1,
  TEMPLATE_PRIORITY: [
    'ACTIVITY_MOMENTUM',
    'FOCUS_SHIFT',
    'REPOSITORY_CONCENTRATION',
    'CONSISTENCY',
    'REVIEW_CONTRIBUTION',
    'PROJECT_HEALTH',
    'LANGUAGE_MIX_CHANGE',
    'QUIET_PERIOD',
  ],
  TEMPLATE_IDS: {
    ACTIVITY_MOMENTUM: 'activity_momentum',
    FOCUS_SHIFT: 'focus_shift',
    REPOSITORY_CONCENTRATION: 'repository_concentration',
    CONSISTENCY: 'consistency',
    REVIEW_CONTRIBUTION: 'review_contribution',
    PROJECT_HEALTH: 'project_health',
    LANGUAGE_MIX_CHANGE: 'language_mix_change',
    QUIET_PERIOD: 'quiet_period',
  },
  MAX_INSIGHTS: 8,
  evaluateInsights,
  evaluateActivityMomentum: require('./insights-activity-focus').evaluateActivityMomentum,
  evaluateFocusShift: require('./insights-activity-focus').evaluateFocusShift,
  evaluateRepositoryConcentration: require('./insights-repo-consistency').evaluateRepositoryConcentration,
  evaluateConsistency: require('./insights-repo-consistency').evaluateConsistency,
  evaluateReviewContribution: require('./insights-contrib-health').evaluateReviewContribution,
  evaluateProjectHealth: require('./insights-contrib-health').evaluateProjectHealth,
  evaluateLanguageMixChange: require('./insights-lang-quiet').evaluateLanguageMixChange,
  evaluateQuietPeriod: require('./insights-lang-quiet').evaluateQuietPeriod,
};
