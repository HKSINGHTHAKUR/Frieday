import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import Card from '../ui/Card.jsx';
import { formatAgo } from '../../lib/format.js';
import { useSync } from '../../store/SyncStore.jsx';
import { useToast } from '../../store/ToastStore.jsx';

const RESOURCE_LABELS = {
  repos: 'Repositories',
  commits: 'Commits',
  pulls: 'Pull requests',
  issues: 'Issues',
  languages: 'Languages',
};

/**
 * Settings sync card (T5.3): single-flight Resync (409-aware), per-resource
 * last-synced states, and recent sync history from GET /api/sync/status.
 */
export default function SyncSettings({ connected }) {
  const sync = useSync();
  const toast = useToast();
  const { status, resources, history, startSync, starting } = sync;
  const running = status === 'queued' || status === 'running';

  const handleResync = async () => {
    const result = await startSync();
    if (result.ok) {
      toast.push('success', 'Resync started.');
    } else if (result.conflict) {
      toast.push('warning', result.message || 'A sync is already running.');
    } else {
      toast.push('danger', (result.error && result.error.message) || 'Could not start the resync.');
    }
  };

  return (
    <Card title="Sync">
      <div className="flex flex-col gap-16">
        <div className="flex flex-wrap items-center gap-12">
          <Button
            variant="primary"
            size="sm"
            onClick={handleResync}
            loading={starting || running}
            disabled={starting || running || !connected}
          >
            {running ? 'Syncing…' : 'Resync now'}
          </Button>
          <p className="text-xs text-text3">
            {running
              ? 'A sync is running — progress is shown at the top of the page.'
              : 'Fetches the latest commits, pull requests, issues, and languages from GitHub.'}
          </p>
        </div>
        <ResourceStates resources={resources} />
        <SyncHistory history={history} />
      </div>
    </Card>
  );
}

function ResourceStates({ resources }) {
  const entries = Object.entries(resources ?? {});
  if (!entries.length) return null;
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-text3">Per-resource status</h3>
      <ul className="mt-8 flex flex-col gap-4">
        {entries.map(([name, state]) => (
          <li key={name} className="flex items-center justify-between text-sm">
            <span className="text-text2">{RESOURCE_LABELS[name] ?? name}</span>
            <span className="flex items-center gap-8">
              <Badge
                tone={state.status === 'done' ? 'success' : state.status === 'failed' ? 'danger' : 'neutral'}
              >
                {state.status}
              </Badge>
              {state.lastSyncedAt && (
                <span className="text-xs text-text3">{formatAgo(state.lastSyncedAt)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SyncHistory({ history }) {
  const items = (history ?? []).slice(0, 10);
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-text3">Recent syncs</h3>
      <table className="mt-8 w-full text-sm" role="table">
        <thead>
          <tr className="border-b border-border-strong">
            <th scope="col" className="py-8 text-left text-xs font-medium uppercase tracking-wide text-text3">
              Kind
            </th>
            <th scope="col" className="py-8 text-left text-xs font-medium uppercase tracking-wide text-text3">
              Status
            </th>
            <th
              scope="col"
              className="py-8 text-right text-xs font-medium uppercase tracking-wide text-text3"
            >
              Started
            </th>
            <th
              scope="col"
              className="py-8 text-right text-xs font-medium uppercase tracking-wide text-text3"
            >
              Finished
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((job) => (
            <tr key={job.jobId ?? `${job.startedAt}`} className="border-b border-border last:border-b-0">
              <td className="py-8 text-text2">{job.kind ?? '—'}</td>
              <td className="py-8">
                <Badge
                  tone={
                    job.status === 'succeeded' ? 'success' : job.status === 'failed' ? 'danger' : 'neutral'
                  }
                >
                  {job.status}
                </Badge>
                {job.error && <span className="ml-8 text-xs text-text3">{job.error}</span>}
              </td>
              <td className="py-8 text-right text-xs text-text3">
                {job.startedAt ? formatAgo(job.startedAt) : '—'}
              </td>
              <td className="py-8 text-right text-xs text-text3">
                {job.finishedAt ? formatAgo(job.finishedAt) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
