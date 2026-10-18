import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import AvatarMenu from './AvatarMenu.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { useSync } from '../../store/SyncStore.jsx';
import { useToast } from '../../store/ToastStore.jsx';

/**
 * App topbar (design_system.md §14): wordmark, connection status, "Sync now",
 * avatar menu (Settings / Disconnect / Logout). Sync is single-flight: a 409
 * conflict surfaces the running job's progress instead of a duplicate job.
 */
export default function Topbar() {
  const { connected } = useAuth();
  const { startSync, starting, status, conflict } = useSync();
  const toast = useToast();

  const syncing = status === 'queued' || status === 'running';
  const busy = starting || syncing;

  const handleSync = async () => {
    const result = await startSync();
    if (result.ok) {
      toast.push('success', 'Sync started.');
    } else if (result.conflict) {
      toast.push('warning', result.message || 'A sync is already running.');
    } else {
      toast.push('danger', (result.error && result.error.message) || 'Could not start the sync.');
    }
  };

  return (
    <header className="flex h-topbar items-center gap-16 border-b border-border bg-surface px-24">
      <a href="/" className="text-base font-bold tracking-tight text-text">
        Frieday
      </a>
      <div className="ml-auto flex items-center gap-12">
        <Badge tone={connected ? 'success' : 'warning'} role="status">
          {connected ? 'GitHub connected' : 'GitHub disconnected'}
        </Badge>
        <Button variant="primary" size="sm" onClick={handleSync} loading={busy} disabled={busy || !connected}>
          {syncing ? 'Syncing…' : conflict ? 'Sync now (conflict)' : 'Sync now'}
        </Button>
        <AvatarMenu />
      </div>
    </header>
  );
}
