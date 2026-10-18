/**
 * Review Contribution & Project Health templates (T4.3)
 */

const { CONFIDENCE, buildEvidence, computeInsightConfidence } = require('./insights-core');

/**
 * Template 5: Review Contribution
 * PRs reviewed/merged vs authored.
 */
function evaluateReviewContribution({ pullRequests }) {
  const authored = pullRequests.filter((pr) => pr.isAuthoredByUser).length;
  const reviewed = pullRequests.filter((pr) => pr.isReviewedByUser).length;
  const merged = pullRequests.filter((pr) => pr.mergedAt).length;

  if (authored === 0 && reviewed === 0 && merged === 0) return null;

  const total = authored + reviewed;
  const reviewedPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  const text = `Authored ${authored} PRs, reviewed ${reviewed} PRs (${reviewedPct}% of total involvement).`;

  const prNumbers = pullRequests.filter((pr) => pr.number).map((pr) => pr.number);

  return {
    templateId: 'review_contribution',
    title: 'Review Contribution',
    text,
    metrics: { authored, reviewed, merged, reviewedPct },
    evidence: buildEvidence({ prNumbers }),
    confidence: computeInsightConfidence({ sampleSize: total }),
    timeRange: null,
  };
}

/**
 * Template 6: Project Health Flag
 * Repository went quiet / was revived.
 */
function evaluateProjectHealth({ repoHealth, previousRepoHealth }) {
  const insights = [];

  for (const current of repoHealth) {
    const previous = previousRepoHealth?.find((p) => p.repoId === current.repoId);
    if (!previous) continue;

    const wasQuietOrStalled = ['quiet', 'stalled'].includes(previous.health);
    const isNowActiveOrSteady = ['active', 'steady'].includes(current.health);

    if (wasQuietOrStalled && isNowActiveOrSteady) {
      insights.push({
        templateId: 'project_health',
        title: 'Project Health',
        text: `${current.repoName} revived — moved from ${previous.health} to ${current.health}.`,
        metrics: {
          repoId: current.repoId,
          repoName: current.repoName,
          previousHealth: previous.health,
          currentHealth: current.health,
          daysSinceActivity: current.daysSinceActivity,
        },
        evidence: buildEvidence({ repoIds: [current.repoId] }),
        confidence: CONFIDENCE.HIGH,
        timeRange: null,
      });
    } else if (
      ['active', 'steady'].includes(previous.health) &&
      ['quiet', 'stalled'].includes(current.health)
    ) {
      insights.push({
        templateId: 'project_health',
        title: 'Project Health',
        text: `${current.repoName} went quiet — moved from ${previous.health} to ${current.health} (${current.daysSinceActivity} days since activity).`,
        metrics: {
          repoId: current.repoId,
          repoName: current.repoName,
          previousHealth: previous.health,
          currentHealth: current.health,
          daysSinceActivity: current.daysSinceActivity,
        },
        evidence: buildEvidence({ repoIds: [current.repoId] }),
        confidence: CONFIDENCE.HIGH,
        timeRange: null,
      });
    }
  }

  return insights;
}

module.exports = {
  evaluateReviewContribution,
  evaluateProjectHealth,
};
