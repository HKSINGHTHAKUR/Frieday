import Badge from '../ui/Badge.jsx';

/**
 * CommitThemesCard — Phase 10.1 deterministic commit-theme clustering.
 *
 * Truth contract (prd.md §2, §18; rules.md §24):
 *   - A theme means "N commit headlines contained a term from this theme's
 *     rule set". It never claims a skill, intent, or specialisation.
 *   - Percentages are over THEMED commits only; the denominator is always
 *     shown next to the number.
 *   - Unclassified / no-message / maintenance counts are surfaced, never
 *     silently folded into a theme.
 *
 * Evidence is bounded by the server (≤20 SHAs, ≤5 headline samples, never
 * the commit body).
 */
function confidenceTone(confidence) {
  if (confidence === 'High') return 'success';
  if (confidence === 'Medium') return 'warning';
  return 'info';
}

export default function CommitThemesCard({ themes }) {
  const items = Array.isArray(themes?.items) ? themes.items : [];
  const themedCommits = themes?.themedCommits ?? 0;

  // No themed commits → honest empty state, never a fabricated distribution.
  if (items.length === 0 || themedCommits === 0) {
    return (
      <section
        className="rounded-md border border-border bg-surface p-20 shadow-sm"
        aria-labelledby="commit-themes-heading"
      >
        <div className="mb-16 flex items-center justify-between gap-12">
          <h2 id="commit-themes-heading" className="text-base font-semibold leading-6 text-text">
            Commit themes
          </h2>
        </div>
        <div className="py-16 text-center">
          <p className="text-text3">No commit themes detected</p>
          <p className="mt-4 text-sm text-text3">Not enough commit-message detail to identify themes.</p>
        </div>
      </section>
    );
  }

  const { unclassified = 0, noMessage = 0, noise = 0 } = themes;

  return (
    <section
      className="rounded-md border border-border bg-surface p-20 shadow-sm"
      aria-labelledby="commit-themes-heading"
    >
      <div className="mb-16 flex items-center justify-between gap-12">
        <h2 id="commit-themes-heading" className="text-base font-semibold leading-6 text-text">
          Commit themes
        </h2>
        <span className="text-xs text-text3">of {themedCommits} themed commits</span>
      </div>

      <ul className="space-y-12" role="list" aria-label="Commit themes">
        {items.map((item) => {
          const percent = Math.round((item.share ?? 0) * 1000) / 10;
          const samples = item.evidence?.sampleMessages ?? [];
          return (
            <li key={item.theme} className="min-w-0">
              <div className="flex flex-wrap items-center gap-8">
                <span className="font-medium text-text">{item.theme}</span>
                <Badge tone={confidenceTone(item.confidence)}>{item.confidence}</Badge>
                <span className="mono text-xs text-text2">
                  {item.commitCount} · {percent}%
                </span>
              </div>
              {item.evidence?.repoNames?.length > 0 && (
                <p className="mt-4 break-words text-sm text-text2">{item.evidence.repoNames.join(', ')}</p>
              )}
              {samples.length > 0 && (
                <ul className="mt-4 space-y-2" role="list" aria-label={`${item.theme} sample commits`}>
                  {samples.map((message) => (
                    <li key={message} className="mono break-words text-xs text-text3" title={message}>
                      {message}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* Honest accounting of what is NOT a theme. */}
      <div className="mt-16 border-t border-border pt-12">
        <p className="text-xs text-text3">
          {(unclassified > 0 || noMessage > 0 || noise > 0) && (
            <>
              {unclassified > 0 && `${unclassified} unclassified`}
              {unclassified > 0 && (noMessage > 0 || noise > 0) && ' · '}
              {noMessage > 0 && `${noMessage} without a message`}
              {noMessage > 0 && noise > 0 && ' · '}
              {noise > 0 && `${noise} maintenance`}
            </>
          )}
        </p>
        <p className="mt-4 text-xs text-text3">
          Themes are matched from exact terms in your commit messages. They describe what you wrote, not what
          you are skilled at.
        </p>
      </div>
    </section>
  );
}
