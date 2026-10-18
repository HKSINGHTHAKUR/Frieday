/**
 * Language Mix Change & Quiet Period templates (T4.3)
 */

const { CONFIDENCE, buildEvidence, computeInsightConfidence } = require('./insights-core');

/**
 * Template 7: Language Mix Change
 * Compare current vs previous language mix.
 */
function evaluateLanguageMixChange({ current, previous }) {
  const currentLangs = current.languages?.weightedBytes || {};
  const previousLangs = previous.languages?.weightedBytes || {};

  const allLangs = new Set([...Object.keys(currentLangs), ...Object.keys(previousLangs)]);

  let maxChange = 0;
  let changedLang = null;

  for (const lang of allLangs) {
    const curr = currentLangs[lang] || 0;
    const prev = previousLangs[lang] || 0;
    const change = Math.abs(curr - prev);
    if (change > maxChange) {
      maxChange = change;
      changedLang = lang;
    }
  }

  if (maxChange === 0) return null;

  const totalCurrent = Object.values(currentLangs).reduce((a, b) => a + b, 0);
  const totalPrevious = Object.values(previousLangs).reduce((a, b) => a + b, 0);

  if (totalCurrent === 0 && totalPrevious === 0) return null;

  const currPct = totalCurrent > 0 ? Math.round(((currentLangs[changedLang] || 0) / totalCurrent) * 100) : 0;
  const prevPct =
    totalPrevious > 0 ? Math.round(((previousLangs[changedLang] || 0) / totalPrevious) * 100) : 0;
  const delta = currPct - prevPct;

  if (Math.abs(delta) < 5) return null;

  const direction = delta > 0 ? 'increased' : 'decreased';

  return {
    templateId: 'language_mix_change',
    title: 'Language Mix Change',
    text: `${changedLang} share ${direction} from ${prevPct}% to ${currPct}% (weighted bytes).`,
    metrics: {
      language: changedLang,
      currentPercent: currPct,
      previousPercent: prevPct,
      deltaPercent: delta,
    },
    evidence: buildEvidence({}),
    confidence: computeInsightConfidence({
      sampleSize: Object.values(currentLangs).reduce((a, b) => a + b, 0),
    }),
    timeRange: null,
  };
}

/**
 * Template 8: Quiet Period Note
 * Use T4.2 gap output - neutral language about gaps.
 */
function evaluateQuietPeriod({ consistency }) {
  const { gaps } = consistency;
  const longGaps = gaps.filter((g) => g.length >= 7);

  if (!longGaps.length) return null;

  const longestGap = longGaps.reduce((max, g) => (g.length > max.length ? g : max), longGaps[0]);

  const start = new Date(longestGap.start);
  const end = new Date(longestGap.end);
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const text = `No recorded activity ${startStr}–${endStr} — this may include private or unconnected work.`;

  return {
    templateId: 'quiet_period',
    title: 'Quiet Period',
    text,
    metrics: {
      gapStart: longestGap.start,
      gapEnd: longestGap.end,
      gapLength: longestGap.length,
      gapLabel: longestGap.label,
    },
    evidence: buildEvidence({ bucketStarts: [new Date(longestGap.start), new Date(longestGap.end)] }),
    confidence: CONFIDENCE.MEDIUM,
    timeRange: null,
  };
}

module.exports = {
  evaluateLanguageMixChange,
  evaluateQuietPeriod,
};
