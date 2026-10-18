/**
 * Activity Momentum & Focus Shift templates (T4.3)
 */

const { computeDelta, SUPPRESSION_REASON } = require('./deltas');
const { buildEvidence, computeInsightConfidence, TEMPLATE_IDS } = require('./insights-core');

/**
 * Template 1: Activity Momentum
 * Compare current period against prior equal-length period.
 * States: up / down / flat
 */
function evaluateActivityMomentum({ current, previous, range, anchor }) {
  const currentCommits = current.timeline.reduce((sum, b) => sum + b.commits, 0);
  const previousCommits = previous.timeline.reduce((sum, b) => sum + b.commits, 0);

  // Suppress when there's truly no activity in either period
  if (currentCommits === 0 && previousCommits === 0) {
    return null;
  }

  const delta = computeDelta(currentCommits, previousCommits);

  if (delta.reason === SUPPRESSION_REASON) {
    return null;
  }

  let state = 'flat';
  if (delta.value > 10) state = 'up';
  else if (delta.value < -10) state = 'down';

  return {
    templateId: TEMPLATE_IDS.ACTIVITY_MOMENTUM,
    title: 'Activity Momentum',
    text: `Activity ${state === 'up' ? 'increased' : state === 'down' ? 'decreased' : 'remained flat'} (${delta.display}) vs prior ${range}.`,
    metrics: {
      currentCommits,
      previousCommits,
      deltaPercent: delta.value,
      deltaDisplay: delta.display,
      state,
    },
    evidence: buildEvidence({
      bucketStarts: current.timeline.map((b) => b.bucketStart),
    }),
    confidence: computeInsightConfidence({
      sampleSize: currentCommits + previousCommits,
      hasValidDelta: delta.reason !== SUPPRESSION_REASON,
    }),
    timeRange: { range, anchor: anchor.toISOString() },
  };
}

/**
 * Template 2: Focus Shift
 * Compare top focus area in current vs prior period.
 */
function evaluateFocusShift({ current, previous }) {
  const currentTop = current.focus?.[0];
  const previousTop = previous.focus?.[0];

  if (!currentTop || !previousTop) return null;
  if (currentTop.tag === previousTop.tag) return null;

  const currentCommits = currentTop.evidence?.repoNames?.length || 0;
  const previousCommits = previousTop.evidence?.repoNames?.length || 0;

  return {
    templateId: TEMPLATE_IDS.FOCUS_SHIFT,
    title: 'Focus Shift',
    text: `Recent work shifted from ${previousTop.tag} to ${currentTop.tag}.`,
    metrics: {
      currentFocus: currentTop.tag,
      previousFocus: previousTop.tag,
      currentCommits: currentTop.evidence?.repoNames?.length || 0,
      previousCommits: previousTop.evidence?.repoNames?.length || 0,
    },
    evidence: buildEvidence({
      repoIds: [
        ...new Set([...(currentTop.evidence?.repoNames || []), ...(previousTop.evidence?.repoNames || [])]),
      ],
    }),
    confidence: computeInsightConfidence({
      sampleSize: currentCommits + previousCommits,
      repoCount: new Set([
        ...(currentTop.evidence?.repoNames || []),
        ...(previousTop.evidence?.repoNames || []),
      ]).size,
    }),
    timeRange: null,
  };
}

module.exports = {
  evaluateActivityMomentum,
  evaluateFocusShift,
};
