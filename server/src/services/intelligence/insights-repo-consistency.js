/**
 * Repository Concentration & Consistency templates (T4.3)
 */

const { CONFIDENCE, buildEvidence, computeInsightConfidence } = require('./insights-core');

/**
 * Template 3: Repository Concentration
 * Calculate commit concentration across repositories.
 */
function evaluateRepositoryConcentration({ commits, repositories, _timeline }) {
  if (!commits.length || !repositories.length) return null;

  const commitsByRepo = new Map();
  for (const c of commits) {
    if (c.repoId) {
      const key = c.repoId.toString();
      commitsByRepo.set(key, (commitsByRepo.get(key) || 0) + 1);
    }
  }

  const totalCommits = commits.length;
  const sortedRepos = [...commitsByRepo.entries()].sort((a, b) => b[1] - a[1]);

  if (sortedRepos.length === 0) return null;

  const topRepoCount = sortedRepos[0][1];
  const topRepoPct = Math.round((topRepoCount / totalCommits) * 100);
  const topTwoPct = (sortedRepos.slice(0, 2).reduce((sum, [, count]) => sum + count, 0) / totalCommits) * 100;

  if (topRepoPct < 30 && topTwoPct <= 50) return null;

  const topRepoIds = sortedRepos.slice(0, 2).map(([repoId]) => repoId);

  return {
    templateId: 'repository_concentration',
    title: 'Repository Concentration',
    text: `${topRepoPct}% of commits in top ${sortedRepos.length > 1 ? '2' : '1'} repo${sortedRepos.length > 1 ? 's' : ''}.`,
    metrics: {
      totalCommits,
      topRepoPct,
      topTwoPct: Math.round(topTwoPct),
      repoCount: repositories.length,
    },
    evidence: buildEvidence({ repoIds: topRepoIds }),
    confidence: computeInsightConfidence({
      sampleSize: totalCommits,
      repoCount: Math.min(2, repositories.length),
    }),
    timeRange: null,
  };
}

/**
 * Template 4: Consistency Note
 * Use T4.2 consistency output.
 */
function evaluateConsistency({ consistency, range }) {
  const { activeDays, currentStreak, longestStreak, gaps } = consistency;

  if (activeDays === 0) {
    return {
      templateId: 'consistency',
      title: 'Consistency',
      text: `No recorded activity in the last ${range}.`,
      metrics: { activeDays: 0, currentStreak: 0, longestStreak: 0 },
      evidence: buildEvidence({}),
      confidence: CONFIDENCE.LOW,
      timeRange: null,
    };
  }

  let text = `Active ${activeDays} of the last ${range === '30d' ? '30' : range === '90d' ? '90' : '365'} days`;
  if (currentStreak > 0) text += ` (current streak: ${currentStreak} days)`;
  if (longestStreak > currentStreak) text += `. Longest streak: ${longestStreak} days.`;

  const bucketStarts = gaps.flatMap((g) => [g.start, g.end]).filter(Boolean);

  return {
    templateId: 'consistency',
    title: 'Consistency',
    text,
    metrics: {
      activeDays,
      currentStreak,
      longestStreak,
      gapCount: gaps.length,
    },
    evidence: buildEvidence({ bucketStarts }),
    confidence: computeInsightConfidence({ sampleSize: activeDays }),
    timeRange: null,
  };
}

module.exports = {
  evaluateRepositoryConcentration,
  evaluateConsistency,
};
