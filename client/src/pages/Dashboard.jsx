import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard.js';
import Card from '../components/ui/Card.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import ErrorCard from '../components/ui/ErrorCard.jsx';
import Badge from '../components/ui/Badge.jsx';
import MetricCaption from '../components/ui/MetricCaption.jsx';
import RangeSelector from '../components/ui/RangeSelector.jsx';
import ActivityChart from '../components/charts/ActivityChart.jsx';
import LanguageDonut from '../components/charts/LanguageDonut.jsx';
import MetricCard from '../components/domain/MetricCard.jsx';
import RepoHealthTable from '../components/domain/RepoHealthTable.jsx';
import InsightsCard from '../components/domain/InsightsCard.jsx';
import CommitThemesCard from '../components/domain/CommitThemesCard.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useSync } from '../store/SyncStore.jsx';
import { useToast } from '../store/ToastStore.jsx';
import { formatCount, formatAgo } from '../lib/format.js';
import { safeNavigate } from '../lib/safeNavigate.js';
import { takePendingDestination } from '../lib/returnDestination.js';

export default function Dashboard() {
  const { range, setRange, data: dashboardData, loading, error } = useDashboard();
  const sync = useSync();
  const { user: authUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const navigate = useNavigate();
  const connectedHandled = useRef(false);

  const { status: syncStatus, phase: syncPhase, progress: syncProgress, loading: syncLoading } = sync;

  // One-time processing of the OAuth callback marker. The server already
  // started the initial sync in the callback, so the client only clears the
  // query param (via replace, so refreshing cannot re-process it) and emits
  // a single piece of feedback. Guarded by a ref so it runs exactly once and
  // never triggers duplicate sync actions or redirect loops.
  //
  // If the user was heading somewhere specific before they signed in, that
  // destination was remembered across the OAuth round-trip; honour it now
  // that the session exists. The redirect REPLACES the entry so the callback
  // URL is not left in the back stack.
  useEffect(() => {
    if (connectedHandled.current) return;
    if (searchParams.get('connected') === '1') {
      connectedHandled.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('connected');
      setSearchParams(next, { replace: true });
      toast.push('success', 'GitHub connected.');

      const destination = takePendingDestination();
      if (destination !== '/') {
        safeNavigate(navigate, destination, { replace: true });
      }
    }
  }, [navigate, searchParams, setSearchParams, toast]);

  if (loading) {
    return (
      <div className="flex flex-col gap-24">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-text">Overview</h1>
        </div>
        <div className="grid grid-cols-4 gap-16">
          {['Active repos', 'Commits', 'PRs', 'Active days'].map((label) => (
            <Card key={label} title={label}>
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}
        </div>
        <Card title="Activity chart" className="col-span-8">
          <div className="h-[320px] flex items-center justify-center">
            <Skeleton className="h-[320px] w-full" />
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-24">
        <h1 className="text-xl font-bold text-text">Overview</h1>
        <ErrorCard
          title="Could not load dashboard"
          message={error?.message || 'Unknown error'}
          requestId={error?.requestId}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  const data = dashboardData;
  const focus = data?.focus || [];
  const consistency = data?.consistency || { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] };
  const deltas = data?.deltas || { deltas: {} };
  const repoHealth = data?.repoHealth || [];
  const insights = data?.insights || [];
  const activeDays = consistency.activeDays ?? 0;
  const totalCommits = data?.kpis?.totalCommits ?? 0;
  const totalPRs = data?.kpis?.totalPRs ?? 0;

  const rangeLabel =
    { '30d': 'last 30 days', '90d': 'last 90 days', '12m': 'last 12 months' }[range] || range;

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-12">
        <div>
          <h1 className="text-xl font-bold text-text">Overview</h1>
          <p className="text-sm text-text3 mt-2">
            {authUser?.login ? `Welcome back, ${authUser.login}` : 'Your developer activity'}
            {rangeLabel ? ` · ${rangeLabel}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-12">
          <RangeSelector range={range} onChange={setRange} />
        </div>
      </div>

      {syncLoading ? (
        <div className="flex items-center gap-12 text-sm text-text3">
          <span className="w-4 h-4 rounded-full bg-warning animate-pulse" aria-hidden="true" />
          <span className="text-text2">Syncing… {syncPhase ? `(${syncPhase})` : ''}</span>
          {syncProgress?.total > 0 && (
            <span>
              {syncProgress.done}/{syncProgress.total}
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-12 text-sm text-text3">
          <span
            className={`w-4 h-4 rounded-full ${syncStatus === 'done' ? 'bg-success' : syncStatus === 'error' ? 'bg-danger' : syncStatus === 'syncing' ? 'bg-warning animate-pulse' : 'bg-text3'}`}
            aria-hidden="true"
          />
          <span className="text-text2 capitalize">{syncStatus || 'Idle'}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-16">
        <MetricCard
          title="Active repos"
          value={formatCount(data?.kpis?.repoCount ?? 0)}
          caption={<MetricCaption range={range} scope="your repositories" />}
          delta={deltas.deltas?.repoCount}
        />
        <MetricCard
          title="Commits"
          value={formatCount(totalCommits)}
          caption={<MetricCaption range={range} scope="authored by you" />}
          delta={deltas.deltas?.commits}
        />
        <MetricCard
          title="Pull requests"
          value={formatCount(totalPRs)}
          caption={<MetricCaption range={range} scope="opened by you" />}
          delta={deltas.deltas?.prsOpened}
        />
        <MetricCard
          title="Active days"
          value={activeDays}
          caption={<MetricCaption range={range} scope="active days" />}
          delta={deltas.deltas?.activeDays}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-24">
        <Card
          title="Activity"
          className="lg:col-span-8"
          action={<MetricCaption range={range} scope="commits + PRs (merged)" />}
        >
          <ActivityChart buckets={data?.buckets || []} height={320} />
          <div
            className="mt-12 overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Activity table equivalent"
          >
            <h3 className="sr-only">Activity table</h3>
            <table className="w-full min-w-[320px] text-sm" role="table">
              <thead>
                <tr className="border-b border-border-strong">
                  <th className="text-left py-8 px-12 text-xs font-medium uppercase tracking-wide text-text3">
                    Week
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
                {(data?.buckets || []).slice(-12).map((b) => (
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
        </Card>

        <div className="lg:col-span-4 space-y-16">
          <Card
            title="Languages"
            action={<span className="text-xs text-text3">Weighted by your commits</span>}
          >
            <LanguageDonut data={data?.languages} />
          </Card>

          <Card title="Focus areas">
            {focus.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-text3">No focus areas detected</p>
              </div>
            ) : (
              <ul className="space-y-12" role="list" aria-label="Focus areas">
                {focus.map((f) => (
                  <li key={f.tag} className="flex items-start gap-12">
                    <div className="flex-1">
                      <div className="flex items-center gap-8">
                        <span className="font-medium text-text">{f.tag}</span>
                        <Badge
                          tone={
                            f.confidence === 'High'
                              ? 'success'
                              : f.confidence === 'Medium'
                                ? 'warning'
                                : 'info'
                          }
                        >
                          {f.confidence}
                        </Badge>
                      </div>
                      <p className="text-sm text-text2 mt-4">
                        {f.evidence?.repoNames?.join(', ') || 'No evidence'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Commit themes (Phase 10.1) — sits with the other "what you work
              on" signal. The card owns its own heading/empty state so it
              never overlaps the cards above it. */}
          <CommitThemesCard themes={data?.themes} />

          <Card
            title="Consistency"
            action={<span className="text-xs text-text3">vs. prior {rangeLabel}</span>}
          >
            {' '}
            <div className="space-y-12">
              <div className="flex items-baseline gap-8">
                <span className="metric text-4xl font-bold text-text mono">{activeDays}</span>
                <span className="text-sm text-text2 mt-4">of {rangeLabel}</span>
              </div>
              <div className="flex items-center gap-16 text-sm text-text2">
                <span>
                  Current streak:{' '}
                  <span className="font-mono font-medium text-text">
                    {consistency.currentStreak ?? 0} days
                  </span>
                </span>
                <span>
                  Longest:{' '}
                  <span className="font-mono font-medium text-text">
                    {consistency.longestStreak ?? 0} days
                  </span>
                </span>
              </div>
              {consistency.gaps?.length > 0 && (
                <div className="pt-8 border-t border-border">
                  <p className="text-xs font-medium uppercase tracking-wide text-text3 mb-8">Gaps</p>
                  <ul className="space-y-4">
                    {consistency.gaps.slice(0, 3).map((gap) => (
                      <li key={gap.start} className="flex items-center gap-8 text-sm text-text2">
                        <Badge tone="warning">{gap.label}</Badge>
                        <span>
                          {new Date(gap.start).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                          {' → '}
                          {new Date(gap.end).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                          <span className="text-text3"> ({gap.length} days)</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-24">
        <RepoHealthTable repoHealth={repoHealth} formatAgo={formatAgo} />
        <InsightsCard insights={insights} />
      </div>
    </div>
  );
}
