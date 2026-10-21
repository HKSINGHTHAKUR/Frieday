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
 *
 * Phase 10.2: `scope="per-repo"` renders the same contract for a single
 * repository (the cross-repo card on the Dashboard, the per-repo drill-down
 * on the Repositories page). The heading id is derived from `scope` so two
 * cards can coexist on one page without duplicate ids.
 */
function confidenceTone(confidence) {
  if (confidence === 'High') return 'success';
  if (confidence === 'Medium') return 'warning';
  return 'info';
}

export default function CommitThemesCard({ themes, scope = 'cross-repo', idSuffix = '', repoName = '' }) {
  const items = Array.isArray(themes?.items) ? themes.items : [];
  const themedCommits = themes?.themedCommits ?? 0;
  const isPerRepo = scope === 'per-repo';
  // The heading id must be UNIQUE in the document. Several per-repo panels can
  // be open at the same time (each row owns its own open state), so the id is
  // suffixed with the caller's discriminator (the repository id).
  const headingId = isPerRepo
    ? `repo-commit-themes-heading${idSuffix ? `-${idSuffix}` : ''}`
    : 'commit-themes-heading';
  // The ACCESSIBLE NAME of the region must be unique too, not just the id:
  // two open per-repo panels that share the name "Commit themes for this
  // repository" are two landmarks with the same name, which screen readers
  // cannot tell apart (axe `landmark-unique`). The repository name
  // disambiguates them; without one, the id keeps the names distinct.
  const title = isPerRepo
    ? repoName
      ? `Commit themes for ${repoName}`
      : `Commit themes for this repository${idSuffix ? ` (${idSuffix})` : ''}`
    : 'Commit themes';

  // No themed commits → honest empty state, never a fabricated distribution.
  if (items.length === 0 || themedCommits === 0) {
    return (
      <section
        className="rounded-md border border-border bg-surface p-20 shadow-sm"
        aria-labelledby={headingId}
      >
        <div className="mb-16 flex items-center justify-between gap-12">
          <h2 id={headingId} className="text-base font-semibold leading-6 text-text">
            {title}
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
      aria-labelledby={headingId}
    >
      <div className="mb-16 flex items-center justify-between gap-12">
        <h2 id={headingId} className="text-base font-semibold leading-6 text-text">
          {title}
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
                  {samples.map((message, index) => (
                    // The message text is not a unique key — two commits can
                    // carry the same headline. The index is stable here because
                    // the server sorts the samples and the list never reorders.
                    <li
                      key={`${item.theme}-${index}`}
                      className="mono break-words text-xs text-text3"
                      title={message}
                    >
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
