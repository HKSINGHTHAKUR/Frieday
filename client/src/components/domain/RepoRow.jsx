import { Link } from 'react-router-dom';
import Badge from '../ui/Badge.jsx';
import { formatCount, formatAgo } from '../../lib/format.js';
import RepoThemes from './RepoThemes.jsx';

/**
 * One repository list row (design_system.md §19): identity + visibility,
 * health badge (text, never color-only), factual counts from the API.
 * Numbers render exactly as supplied by GET /api/repos.
 *
 * Phase 10.2: the optional `repoThemes` entry (from the same GET /api/repos
 * response) adds a top-theme chip and the per-repository theme drill-down.
 * When absent — or when the repository has no themed commits — the row is
 * exactly as before.
 */
export default function RepoRow({ repo, repoThemes }) {
  const health = repo.health ?? 'stalled';
  const label = health.charAt(0).toUpperCase() + health.slice(1);

  return (
    <li className="flex flex-col gap-8 border-b border-border px-20 py-12 last:border-b-0 hover:bg-surface2">
      <div className="flex flex-wrap items-center gap-12">
        <Link
          to={`/repositories/${repo.id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          {repo.fullName}
        </Link>
        <Badge tone="neutral">{repo.visibility}</Badge>
        <Badge tone={HEALTH_TONES[health] ?? 'danger'}>{label}</Badge>
        {repo.fork ? <Badge tone="neutral">fork</Badge> : null}
        {repo.primaryLanguage && <span className="text-xs text-text3">{repo.primaryLanguage}</span>}
      </div>
      {repo.description && <p className="truncate text-sm text-text2">{repo.description}</p>}
      <div className="flex flex-wrap items-center gap-16 text-xs text-text3">
        <span>Last activity {repo.lastActivityAt ? formatAgo(repo.lastActivityAt) : '—'}</span>
        <span>{formatCount(repo.openPRs ?? 0)} open PRs</span>
        <span>{formatCount(repo.openIssues ?? 0)} open issues</span>
        {typeof repo.stars === 'number' && <span>{formatCount(repo.stars)} stars</span>}
        <span>Pushed {repo.pushedAt ? formatAgo(repo.pushedAt) : '—'}</span>
      </div>
      {repoThemes ? <RepoThemes repoId={repo.id} repoName={repo.fullName} themes={repoThemes} /> : null}
    </li>
  );
}

const HEALTH_TONES = { active: 'success', steady: 'info', quiet: 'warning', stalled: 'danger' };
