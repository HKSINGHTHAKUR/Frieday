import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorCard from '../components/ui/ErrorCard.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import RepoRow from '../components/domain/RepoRow.jsx';
import { useRepos } from '../hooks/useRepos.js';
import { useAuth } from '../hooks/useAuth.js';
import { useSync } from '../store/SyncStore.jsx';
import { useToast } from '../store/ToastStore.jsx';

const SORTS = [
  { value: 'activity', label: 'Activity' },
  { value: 'recent', label: 'Recent' },
];

/** Start the OAuth flow (server redirects to GitHub and back). Uses
 * location.replace so the login page does not linger in history after the
 * callback redirects to /dashboard (see Login.jsx). */
function connectGitHub() {
  window.location.replace('/api/auth/github');
}

/**
 * Repositories (tasks.md T5.3): cursor-paginated list from GET /api/repos.
 * Sort is URL-synced (`?sort=`); max page size is the contract's 50.
 * Loading, empty ("Connect GitHub to get started"), and error states follow
 * prd.md §20. Numbers render exactly as the API supplies them.
 */
export default function Repositories() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('sort');
  const sort = SORTS.some((s) => s.value === requested) ? requested : 'activity';
  const repos = useRepos();

  useEffect(() => {
    repos.reload(sort);
  }, [sort, repos.reload]);

  const setSort = (value) => {
    const params = new URLSearchParams(searchParams);
    if (value === 'activity') {
      params.delete('sort');
    } else {
      params.set('sort', value);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <h1 className="text-xl font-bold text-text">Repositories</h1>
        <SortSelector sort={sort} setSort={setSort} />
      </div>
      <RepositoriesList sort={sort} repos={repos} />
    </div>
  );
}

function SortSelector({ sort, setSort }) {
  return (
    <div role="group" aria-label="Sort repositories" className="inline-flex items-center gap-8">
      {SORTS.map((s) => (
        <Button
          key={s.value}
          variant={sort === s.value ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={sort === s.value}
          onClick={() => setSort(s.value)}
        >
          {s.label}
        </Button>
      ))}
    </div>
  );
}

function RepositoriesList({ sort, repos }) {
  const { connected } = useAuth();
  const { startSync } = useSync();
  const toast = useToast();
  const { items, hasMore, loading, loadingMore, error, reload, loadMore } = repos;

  if (loading) {
    return (
      <Card title="All repositories">
        <div className="flex flex-col gap-8">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <ErrorCard
        title="Could not load repositories"
        message={error?.message || 'Unknown error'}
        requestId={error?.requestId}
        onRetry={() => reload(sort)}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No repositories synced yet"
        body="Connect GitHub to get started, or run a sync to populate this list."
        actionLabel={connected ? 'Sync now' : 'Connect GitHub'}
        onAction={() =>
          connected ? startSync().then(() => toast.push('success', 'Sync started.')) : connectGitHub()
        }
      />
    );
  }

  return (
    <Card title={`All repositories (${items.length}${hasMore ? '+' : ''})`}>
      <ul className="flex flex-col" aria-label="Repositories">
        {items.map((repo) => (
          <RepoRow key={repo.id} repo={repo} />
        ))}
      </ul>
      {hasMore && (
        <div className="flex justify-center border-t border-border pt-16">
          <Button
            variant="secondary"
            onClick={() => loadMore(sort)}
            loading={loadingMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Next page'}
          </Button>
        </div>
      )}
    </Card>
  );
}
