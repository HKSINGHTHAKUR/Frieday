/**
 * Composer intelligence computation (T4.3)
 */

const intelligence = require('./index');
const { getPreviousAnchor } = require('./composer-core');
const { loadRawData } = require('./composer-data');
const { evaluateInsights } = require('./insights');

/**
 * Compute all intelligence for a given period.
 * Returns a complete intelligence payload.
 */
async function computeIntelligenceForPeriod(userId, range, anchor, rawData, granularity = null) {
  const { commits, pullRequests, issues, repositories, languageSnapshots } = rawData;

  // Compute all intelligence in parallel
  const [timeline, languages, focus, consistency, repoHealth] = await Promise.all([
    Promise.resolve(
      intelligence.timeline.computeTimeline({ range, anchor, commits, pullRequests, issues, granularity })
    ),
    Promise.resolve(intelligence.languages.computeLanguageAggregation({ commits, languageSnapshots })),
    Promise.resolve(intelligence.focus.computeFocusTags({ commits, languageSnapshots, repositories })),
    Promise.resolve(
      intelligence.consistency.computeConsistency({ range, anchor, commits, pullRequests, issues })
    ),
    Promise.resolve(
      intelligence.repoHealth.computeAllRepoHealth({
        repositories: rawData.repositories,
        anchor,
        commits: rawData.commits,
        pullRequests: rawData.pullRequests,
        issues: rawData.issues,
      })
    ),
  ]);

  // Compute deltas by comparing current vs previous period
  const previousAnchor = getPreviousAnchor(range, anchor);
  const previousRawData = await loadRawData(userId, range, previousAnchor);

  const previousTimeline = intelligence.timeline.computeTimeline({
    range,
    anchor: previousAnchor,
    granularity,
    ...previousRawData,
  });

  const previousLanguages = intelligence.languages.computeLanguageAggregation({
    commits: previousRawData.commits,
    languageSnapshots: previousRawData.languageSnapshots,
  });

  const previousConsistency = intelligence.consistency.computeConsistency({
    range,
    anchor: previousAnchor,
    ...previousRawData,
  });

  const previousRepoHealth = intelligence.repoHealth.computeAllRepoHealth({
    repositories: previousRawData.repositories,
    anchor: previousAnchor,
    commits: previousRawData.commits,
    pullRequests: previousRawData.pullRequests,
    issues: previousRawData.issues,
  });

  const currentCommits = rawData.commits.length;
  const previousCommits = previousRawData.commits.length;

  const deltas = intelligence.deltas.computeDeltas({
    current: { commits: currentCommits, prsOpened: 0, prsMerged: 0, issuesTouched: 0 },
    previous: { commits: previousCommits, prsOpened: 0, prsMerged: 0, issuesTouched: 0 },
  });

  return {
    timeline,
    languages,
    focus,
    consistency,
    deltas,
    repoHealth,
    raw: {
      commits: rawData.commits,
      pullRequests: rawData.pullRequests,
      issues: rawData.issues,
      repositories: rawData.repositories,
      timeline,
      languages: { weightedBytes: rawData.languages?.weightedBytes || {}, commitShare: {} },
      focus: rawData.focus || [],
      consistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
      repoHealth: rawData.repoHealth || [],
    },
    previous: {
      timeline: previousTimeline,
      languages: previousLanguages,
      consistency: previousConsistency,
      repoHealth: previousRepoHealth,
      commits: previousRawData.commits,
      pullRequests: previousRawData.pullRequests,
      issues: previousRawData.issues,
      repositories: previousRawData.repositories,
    },
  };
}

/**
 * Evaluate insights using the complete intelligence payload.
 */
function evaluateInsightsFromPayload(payload, range, anchor, _repositories) {
  return evaluateInsights({
    commits: payload.raw.commits,
    pullRequests: payload.raw.pullRequests,
    issues: payload.raw.issues,
    repositories: payload.raw.repositories,
    timeline: payload.raw.timeline,
    languages: payload.raw.languages,
    focus: payload.raw.focus,
    consistency: payload.raw.consistency,
    repoHealth: payload.raw.repoHealth,
    previousCommits: payload.previous.commits,
    previousPullRequests: payload.previous.pullRequests,
    previousIssues: payload.previous.issues,
    previousRepositories: payload.previous.repositories,
    previousTimeline: payload.previous.timeline,
    previousLanguages: payload.previous.languages,
    previousConsistency: payload.previous.consistency,
    previousRepoHealth: payload.previous.repoHealth,
    range,
    anchor,
  });
}

module.exports = {
  computeIntelligenceForPeriod,
  evaluateInsightsFromPayload,
};
