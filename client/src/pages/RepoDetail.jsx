import { Link, useParams, useSearchParams } from 'react-router-dom';
import Badge from '../components/ui/Badge.jsx';
import Card from '../components/ui/Card.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorCard from '../components/ui/ErrorCard.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import MetricCaption from '../components/ui/MetricCaption.jsx';
import ActivityChart from '../components/charts/ActivityChart.jsx';
import { useRepoDetail } from '../hooks/useRepoDetail.js';
import { useAuth } from '../hooks/useAuth.js';
import { formatCount, formatAgo } from '../lib/format.js';

const RANGES = ['30d', '90d', '12m'];

// prd.md §18.1: 30d = day buckets, 90d/12m = week buckets.
function granularityForRange(range) {
  return range === '30d' ? 'day' : 'week';
}

/**
 * Repository detail (tasks.md T5.3): identity, health, mini-timeline
 * sparkline, recent commits/PRs/issues as supplied by GET /api/repos/:id.
 * A 404 renders the safe "no longer accessible" state (prd.md §20) — no
 * cross-user information is revealed.
 */
export default function RepoDetail() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('range');
  const range = RANGES.includes(requested) ? requested : '90d';
  const { data, loading, error, notFound, refetch } = useRepoDetail(id, range);
  const { lastSyncedAt } = useAuth();

  const setRange = (value) => {
    const params = new URLSearchParams(searchParams);
    if (value === '90d') {
      params.delete('range');
    } else {
      params.set('range', value);
    }
    setSearchParams(params, { replace: true });
  };

  if (notFound) {
    return <InaccessibleRepo lastSyncedAt={lastSyncedAt} />;
  }

  return (
    <div className="flex flex-col gap-24">
      <nav aria-label="Breadcrumb" className="text-sm text-text3">
        <Link to="/repositories" className="text-accent underline">
          Repositories
        </Link>
        {' / '}
        <span className="mono">{data ? data.fullName : id}</span>
      </nav>

      {loading && (
        <>
          <Skeleton className="h-48 w-96" />
          <Card title="Recent activity">
            <div className="flex flex-col gap-8">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          </Card>
        </>
      )}

      {!loading && error && (
        <ErrorCard
          title="Could not load this repository"
          message={error?.message || 'Unknown error'}
          requestId={error?.requestId}
          onRetry={refetch}
        />
      )}

      {!loading && data && <RepoDetailBody data={data} range={range} setRange={setRange} />}
    </div>
  );
}

/** prd.md §20: deleted/inaccessible repository — safe, factual wording. */
function InaccessibleRepo({ lastSyncedAt }) {
  return (
    <div className="flex flex-col gap-24">
      <nav aria-label="Breadcrumb" className="text-sm text-text3">
        <Link to="/repositories" className="text-accent underline">
          Repositories
        </Link>
      </nav>
      <EmptyState
        title="This repository is no longer accessible"
        body={
          lastSyncedAt
            ? `It may have been deleted, made private, or removed from your account. It was last synced ${formatAgo(lastSyncedAt)}.`
            : 'It may have been deleted, made private, or removed from your account.'
        }
      />
    </div>
  );
}

function activityLabel(range) {
  const granularity = granularityForRange(range);
  const kind = granularity === 'day' ? 'Daily' : 'Weekly';
  return `${kind} commits, last ${range}`;
}

function RepoDetailBody({ data, range, setRange }) {
  return (
    <>
      <RepoHeader data={data} range={range} setRange={setRange} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-24">
        <Card
          title="Recent activity"
          className="lg:col-span-8"
          action={<MetricCaption range={range} scope={`in ${data.fullName}`} />}
        >
          <RecentActivity data={data} />
        </Card>
        <div className="lg:col-span-4 flex flex-col gap-16">
          <Card title="Health">
            <HealthStats data={data} />
          </Card>
        </div>
      </div>
      <Card title="Activity" className="w-full">
        <ActivityChart buckets={data.miniTimeline ?? []} height={320} />
        <p className="mt-8 text-xs text-text3">{activityLabel(range)}.</p>
      </Card>
    </>
  );
}

function RepoHeader({ data, range, setRange }) {
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-12">
        <h1 className="mono min-w-0 truncate text-xl font-bold text-text">{data.fullName}</h1>
        <Badge tone="neutral">{data.visibility}</Badge>
        <Badge
          tone={
            data.health === 'active'
              ? 'success'
              : data.health === 'steady'
                ? 'info'
                : data.health === 'quiet'
                  ? 'warning'
                  : 'danger'
          }
        >
          {data.health.charAt(0).toUpperCase() + data.health.slice(1)}
        </Badge>
        {data.fork ? <Badge tone="neutral">fork</Badge> : null}
        {data.htmlUrl && (
          <a href={data.htmlUrl} target="_blank" rel="noreferrer" className="text-sm text-accent underline">
            Open on GitHub
          </a>
        )}
      </div>
      {data.description && <p className="text-sm text-text2">{data.description}</p>}
      <div className="flex flex-wrap items-center gap-12" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={`rounded-sm px-12 py-8 text-sm font-medium ${range === r ? 'bg-accent text-white' : 'bg-surface text-text border border-border hover:bg-surface2'}`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

function HealthStats({ data }) {
  return (
    <dl className="flex flex-col gap-8 text-sm">
      <div className="flex justify-between">
        <dt className="text-text2">Open pull requests</dt>
        <dd className="mono font-medium text-text">{formatCount(data.openPRs ?? 0)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-text2">Open issues</dt>
        <dd className="mono font-medium text-text">{formatCount(data.openIssues ?? 0)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-text2">Last activity</dt>
        <dd className="mono font-medium text-text">
          {data.lastActivityAt ? formatAgo(data.lastActivityAt) : '—'}
        </dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-text2">Primary language</dt>
        <dd className="mono font-medium text-text">{data.primaryLanguage ?? '—'}</dd>
      </div>
      {typeof data.stars === 'number' && (
        <div className="flex justify-between">
          <dt className="text-text2">Stars</dt>
          <dd className="mono font-medium text-text">{formatCount(data.stars)}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt className="text-text2">Pushed</dt>
        <dd className="mono font-medium text-text">{data.pushedAt ? formatAgo(data.pushedAt) : '—'}</dd>
      </div>
    </dl>
  );
}

function RecentActivity({ data }) {
  const { commits, pullRequests, issues } = data.recentActivity ?? {};
  const empty =
    (!commits || !commits.length) && (!pullRequests || !pullRequests.length) && (!issues || !issues.length);

  if (empty) {
    return (
      <EmptyState
        title="No recorded activity in this range"
        body="Try a longer range or resync to fetch the latest commits and pull requests."
      />
    );
  }

  return (
    <div className="flex flex-col gap-16">
      <ActivityGroup
        title="Commits"
        items={(commits ?? []).map((c) => ({
          key: c.sha,
          // The API returns the headline only — the commit body is never
          // exposed. A commit with no headline shows an honest placeholder.
          primary: c.messageHeadline || '(no commit message)',
          meta: c.authoredAt,
        }))}
      />
      <ActivityGroup
        title="Pull requests"
        items={(pullRequests ?? []).map((p) => ({
          key: `pr-${p.number}`,
          primary: `#${p.number} ${p.title}`,
          meta: p.mergedAt ?? p.createdAt,
          state: p.state,
        }))}
      />
      <ActivityGroup
        title="Issues"
        items={(issues ?? []).map((i) => ({
          key: `i-${i.number}`,
          primary: `#${i.number} ${i.title}`,
          meta: i.updatedAt ?? i.createdAt,
          state: i.state,
        }))}
      />
    </div>
  );
}

function ActivityGroup({ title, items }) {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-text3">{title}</h3>
      <ul className="mt-8 flex flex-col gap-8">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex items-baseline justify-between gap-12 border-b border-border pb-8 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-text">
              {item.state ? (
                <Badge tone={item.state === 'merged' ? 'success' : 'neutral'}>{item.state}</Badge>
              ) : null}
              <span className={item.state ? 'ml-8' : ''}>{item.primary}</span>
            </span>
            <span className="mono shrink-0 text-xs text-text3">{item.meta ? formatAgo(item.meta) : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
