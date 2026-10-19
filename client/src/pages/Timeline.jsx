import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/ui/Card.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorCard from '../components/ui/ErrorCard.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import Button from '../components/ui/Button.jsx';
import RangeSelector from '../components/ui/RangeSelector.jsx';
import RepoSelector from '../components/ui/RepoSelector.jsx';
import GranularitySelector from '../components/ui/GranularitySelector.jsx';
import ActivityChart from '../components/charts/ActivityChart.jsx';
import { apiGet } from '../lib/apiClient.js';

/**
 * Timeline page — activity over time with chart + table toggle.
 * URL-synced: range, repoId, granularity.
 */
export default function Timeline() {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-synced state
  const range = useMemo(() => searchParams.get('range') || '30d', [searchParams]);
  const repoId = searchParams.get('repoId') || null;
  // Default granularity follows the range (prd.md §9 F4: 30d = day, 90d/12m = week)
  const granularity = searchParams.get('granularity') || (range === '30d' ? 'day' : 'week');

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const [data, setData] = useState(null);
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('chart');

  // Fetch timeline whenever URL filters change
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ range });
    if (repoId) params.set('repoId', repoId);
    if (granularity) params.set('granularity', granularity);

    setLoading(true);
    apiGet(`/api/timeline?${params.toString()}`)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, repoId, granularity]);

  // Load repo list once for the repo filter
  useEffect(() => {
    let cancelled = false;
    apiGet('/api/repos?sort=activity&limit=50')
      .then((payload) => {
        if (cancelled) return;
        const items = payload?.items || [];
        setRepos(items.map((r) => ({ _id: r.id, fullName: r.fullName, visibility: r.visibility })));
      })
      .catch(() => {
        if (!cancelled) setRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex flex-col gap-24">
        <h1 className="text-xl font-bold text-text">Timeline</h1>
        <ErrorCard
          title="Could not load timeline"
          message={error?.message || 'Unknown error'}
          requestId={error?.requestId}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  const buckets = data?.buckets || [];
  const isEmpty = !loading && buckets.length === 0;

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <h1 className="text-xl font-bold text-text">Timeline</h1>
        <div className="flex flex-wrap items-center gap-12">
          <RangeSelector range={range} onChange={(r) => setParam('range', r)} />
          <RepoSelector
            repositories={repos}
            selectedRepoId={repoId}
            onChange={(id) => setParam('repoId', id)}
          />
          <GranularitySelector granularity={granularity} onChange={(g) => setParam('granularity', g)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-12" role="group" aria-label="View toggle">
        <Button
          variant={view === 'chart' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setView('chart')}
          aria-pressed={view === 'chart'}
        >
          Chart
        </Button>
        <Button
          variant={view === 'table' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setView('table')}
          aria-pressed={view === 'table'}
        >
          Table
        </Button>
      </div>

      {view === 'chart' ? (
        <Card
          title="Activity"
          action={
            <span className="text-xs text-text3">{granularity === 'day' ? 'Daily' : 'Weekly'} buckets</span>
          }
        >
          {loading ? (
            <Skeleton className="h-[320px] w-full" />
          ) : (
            <ActivityChart buckets={buckets} height={400} />
          )}
          <div className="mt-12" role="region" aria-label="Activity table equivalent">
            <h3 className="sr-only">Activity table (chart alternative)</h3>
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-border-strong">
                    <th className="text-left py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      Period
                    </th>
                    <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      Commits
                    </th>
                    <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      PRs opened
                    </th>
                    <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      PRs merged
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.bucketStart} className="border-b border-border hover:bg-surface2">
                      <td className="py-8 px-12 text-text3 mono">
                        {new Date(b.bucketStart).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="text-right py-8 px-12 mono text-text">{b.commits ?? 0}</td>
                      <td className="text-right py-8 px-12 mono text-text">{b.prsOpened ?? 0}</td>
                      <td className="text-right py-8 px-12 mono text-text">{b.prsMerged ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : (
        <Card title="Activity table">
          {isEmpty ? (
            <EmptyState
              title="No activity in this range"
              body="Try a longer range or a different repository."
            />
          ) : (
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-border-strong">
                    <th className="text-left py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      Period
                    </th>
                    <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      Commits
                    </th>
                    <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      PRs opened
                    </th>
                    <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      PRs merged
                    </th>
                    <th className="text-right py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                      Issues touched
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.bucketStart} className="border-b border-border hover:bg-surface2">
                      <td className="py-8 px-12 text-text3 mono">
                        {new Date(b.bucketStart).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="text-right py-8 px-12 mono text-text">{b.commits ?? 0}</td>
                      <td className="text-right py-8 px-12 mono text-text">{b.prsOpened ?? 0}</td>
                      <td className="text-right py-8 px-12 mono text-text">{b.prsMerged ?? 0}</td>
                      <td className="text-right py-8 px-12 mono text-text">{b.issuesTouched ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
