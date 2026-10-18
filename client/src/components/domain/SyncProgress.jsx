import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import { useSync } from '../../store/SyncStore.jsx';

/** Deterministic HH:MM formatter for a rate-limit resume time. */
export function formatResumeTime(resumeAt) {
  const then = new Date(resumeAt);
  if (Number.isNaN(then.getTime())) return null;
  return then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const RESOURCE_LABELS = {
  repos: 'Repositories',
  commits: 'Commits',
  pulls: 'Pull requests',
  issues: 'Issues',
  languages: 'Languages',
};

function resourceLabel(name) {
  return RESOURCE_LABELS[name] ?? name;
}

/**
 * Amber per-repo/resource warnings (prd.md §20: partial failure never fakes
 * global success). Sources: the running job's perResource map and the
 * persisted per-resource SyncState errors.
 */
function ResourceWarnings({ perResource, resources }) {
  const jobFailed = Object.entries(perResource ?? {}).filter(([, r]) => r && r.status === 'failed');
  const stateFailed = Object.entries(resources ?? {}).filter(
    ([, r]) => r && r.status === 'failed' && r.error
  );
  if (!jobFailed.length && !stateFailed.length) return null;

  return (
    <ul className="flex flex-col gap-4" aria-label="Sync warnings">
      {jobFailed.map(([name, r]) => (
        <li
          key={name}
          className="rounded-sm border border-warning bg-warningBg px-12 py-8 text-sm text-text2"
        >
          <Badge tone="warning">Warning</Badge>{' '}
          <span className="ml-8">
            {resourceLabel(name)}: {(r && r.error) || 'Failed. Other data is unaffected.'}
          </span>
        </li>
      ))}
      {stateFailed.map(([name, r]) => (
        <li
          key={name}
          className="rounded-sm border border-warning bg-warningBg px-12 py-8 text-sm text-text2"
        >
          <Badge tone="warning">Warning</Badge>{' '}
          <span className="ml-8">
            {resourceLabel(name)}: {r.error}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Global sync progress card (design_system.md §24). Renders only when there
 * is something to say: running progress, a rate-limited resume, a failure,
 * or partial per-resource warnings.
 */
export default function SyncProgress() {
  const sync = useSync();
  const { status, phase, done, total, error, resumeAt, perResource, resources, startSync, starting } = sync;

  if (status === 'idle') return null;

  const running = status === 'queued' || status === 'running';
  const rateLimited = error && error.code === 'RATE_LIMITED';
  // Revoked/expired GitHub token (prd.md §20, design_system.md §26): classified
  // UNAUTHENTICATED server-side (retryable:false) — never a retry loop; the
  // existing OAuth entry point is the reconnect path.
  const authExpired = error && error.code === 'UNAUTHENTICATED';
  const resumeLabel = rateLimited && resumeAt ? formatResumeTime(resumeAt) : null;

  return (
    <div role="status" aria-live="polite" className="rounded-md border border-border bg-surface p-16">
      <div className="flex flex-wrap items-center gap-12">
        {running && (
          <>
            <span className="h-8 w-8 animate-pulse rounded-full bg-warning" aria-hidden="true" />
            <p className="text-sm font-medium text-text">
              Syncing {phase ?? 'your data'} {total > 0 ? `${done}/${total}` : ''}…
            </p>
            <p className="text-xs text-text3">You can leave — the sync continues server-side.</p>
          </>
        )}
        {status === 'succeeded' && (
          <p className="text-sm text-text2">
            <Badge tone="success">Sync complete</Badge>
            <span className="ml-8">All connected resources are up to date.</span>
          </p>
        )}
        {rateLimited && (
          <p className="text-sm text-text2">
            GitHub rate limit reached. Resumes automatically{resumeLabel ? ` at ${resumeLabel}` : ''}.
          </p>
        )}
        {authExpired && (
          <p className="text-sm text-text2">
            <Badge tone="danger">GitHub connection expired</Badge>
            <span className="ml-8">
              Reconnect GitHub to continue syncing. Your data and insights remain available.
            </span>
          </p>
        )}
        {status === 'failed' && !rateLimited && !authExpired && error && (
          <p className="text-sm text-text2">Sync failed: {error.message ?? 'Something went wrong.'}</p>
        )}
        {!running && !authExpired && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => startSync()}
            loading={starting}
            disabled={starting}
          >
            Retry sync
          </Button>
        )}
        {!running && authExpired && (
          <a
            href="/api/auth/github"
            className="inline-flex h-36 items-center justify-center rounded-sm bg-accent px-16 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Reconnect GitHub
          </a>
        )}
      </div>
      {running && total > 0 && (
        <div
          className="mt-8 h-8 w-full overflow-hidden rounded-full bg-surface2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label="Sync progress"
        >
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.min(100, Math.round((done / total) * 100))}%` }}
          />
        </div>
      )}
      <div className="mt-8">
        <ResourceWarnings perResource={perResource} resources={resources} />
      </div>
    </div>
  );
}
