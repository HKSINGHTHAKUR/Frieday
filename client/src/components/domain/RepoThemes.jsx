import { useState } from 'react';
import Badge from '../ui/Badge.jsx';
import CommitThemesCard from './CommitThemesCard.jsx';

/**
 * RepoThemes — Phase 10.2 per-repository commit-theme drill-down.
 *
 * Renders a compact top-theme chip for one repository and, when opened, the
 * full theme breakdown for that repository.
 *
 * Truth contract (prd.md §2, §18; rules.md §24):
 *   - The chip is shown ONLY when the repository has at least one themed
 *     commit. A repository with no classified commits gets no chip — never an
 *     invented top theme.
 *   - The chip names the highest-count theme. Ties are broken deterministically
 *     by the server (documented THEME_PRIORITY), so the same data always
 *     yields the same chip.
 *   - The chip is labelled as a count of commits, not a share of skill.
 *
 * The breakdown itself is rendered by the shared `CommitThemesCard`, so the
 * per-repo view and the cross-repo Dashboard card obey the same denominator,
 * bucket and disclaimer rules.
 */
export default function RepoThemes({ repoId, repoName, themes }) {
  const [open, setOpen] = useState(false);

  const topTheme = themes?.topTheme ?? null;
  const themedCommits = themes?.themedCommits ?? 0;

  // No classified commits → no chip, and no drill-down to offer.
  if (!topTheme || themedCommits === 0) {
    return null;
  }

  const panelId = `repo-themes-${repoId}`;
  const percent = Math.round((topTheme.share ?? 0) * 1000) / 10;
  // The toggle's accessible name must identify WHICH repository it opens:
  // several rows can be open at once, and "View themes" alone gives a screen
  // reader no way to tell the controls apart.
  const actionLabel = repoName
    ? `${repoName}: ${open ? 'Hide themes' : 'View themes'}`
    : open
      ? 'Hide themes'
      : 'View themes';

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-8">
        <Badge tone="info" title={`Top theme: ${topTheme.theme}`}>
          {topTheme.theme} · {topTheme.commitCount} {topTheme.commitCount === 1 ? 'commit' : 'commits'}
        </Badge>
        <span className="text-xs text-text3">{percent}% of themed commits</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="rounded-sm text-xs font-medium text-accent underline-offset-2 hover:underline"
        >
          {actionLabel}
        </button>
      </div>
      {open && (
        <div id={panelId}>
          <CommitThemesCard themes={themes} scope="per-repo" idSuffix={repoId} repoName={repoName} />
        </div>
      )}
    </div>
  );
}
