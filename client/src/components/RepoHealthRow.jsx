import { memo } from 'react';

export const RepoHealthRow = memo(function RepoHealthRow({ repo, formatAgo }) {
  const healthClass =
    repo.health === 'active'
      ? 'bg-success/10 text-success'
      : repo.health === 'steady'
        ? 'bg-info/10 text-info'
        : repo.health === 'quiet'
          ? 'bg-warning/10 text-warning'
          : 'bg-danger/10 text-danger';
  return (
    <tr key={repo.repoId} className="border-b border-border hover:bg-surface2">
      <td className="py-8 px-12 text-text">
        <div className="font-medium text-text mono">{repo.repoName}</div>
      </td>
      <td className="text-center py-8 px-12">
        <span className={`inline-flex items-center px-8 py-4 rounded-md text-sm font-medium ${healthClass}`}>
          {repo.health}
        </span>
      </td>
      <td className="text-right py-8 px-12 mono text-text">{repo.openPRs ?? 0}</td>
      <td className="text-right py-8 px-12 mono text-text">{repo.openIssues ?? 0}</td>
      <td className="text-right py-8 px-12 mono text-text3">
        {repo.lastActivityAt ? formatAgo(repo.lastActivityAt) : '—'}
      </td>
    </tr>
  );
});

export default RepoHealthRow;
