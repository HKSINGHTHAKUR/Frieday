import Card from '../ui/Card.jsx';
import RepoHealthRow from '../RepoHealthRow.jsx';

/**
 * RepoHealthTable — repository health presentation for the Dashboard.
 * Renders rows from the dashboard payload `repoHealth` array.
 */
export default function RepoHealthTable({ repoHealth = [], formatAgo }) {
  return (
    <Card
      title="Repository health"
      action={
        <a href="/repositories" className="text-sm text-accent underline">
          View all
        </a>
      }
    >
      {repoHealth.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-text3">No repositories synced yet</p>
          <p className="text-sm text-text3 mt-4">Run Sync to populate repository health.</p>
        </div>
      ) : (
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="border-b border-border-strong">
                <th className="text-left py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                  Repository
                </th>
                <th className="text-center py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                  Health
                </th>
                <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                  Open PRs
                </th>
                <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                  Open issues
                </th>
                <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                  Last activity
                </th>
              </tr>
            </thead>
            <tbody>
              {repoHealth.map((repo) => (
                <RepoHealthRow key={repo.repoId} repo={repo} formatAgo={formatAgo} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
