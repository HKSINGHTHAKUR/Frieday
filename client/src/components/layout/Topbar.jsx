import { useState } from 'react';
import { Menu } from 'lucide-react';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import AvatarMenu from './AvatarMenu.jsx';
import MobileNav from './MobileNav.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { useSync } from '../../store/SyncStore.jsx';
import { useToast } from '../../store/ToastStore.jsx';

/**
 * App topbar (design_system.md §14): wordmark, connection status, "Sync now",
 * avatar menu (Settings / Disconnect / Logout). Sync is single-flight: a 409
 * conflict surfaces the running job's progress instead of a duplicate job.
 *
 * Below 640px the topbar condenses (design_system.md §27): the hamburger
 * opens the MobileNav slide-over, the connection badge is hidden (the
 * sidebar/panel carries that state), and the "Sync now" button collapses to
 * a compact "Sync" label so the avatar + menu always stay reachable. The
 * full-label button is removed from the layout (display:none), so only one
 * sync control is ever in the accessibility tree.
 */
export default function Topbar() {
  const { connected } = useAuth();
  const { startSync, starting, status, conflict } = useSync();
  const toast = useToast();
  const [navOpen, setNavOpen] = useState(false);

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
    <>
      <header className="flex h-topbar items-center gap-16 border-b border-border bg-surface px-16 sm:px-24">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          className="-ml-8 flex h-32 w-32 items-center justify-center rounded-sm text-text2 hover:bg-surface2 sm:hidden"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
        <a href="/" className="text-base font-bold tracking-tight text-text">
          Frieday
        </a>
        <div className="ml-auto flex items-center gap-12">
          <Badge tone={connected ? 'success' : 'warning'} role="status" className="hidden sm:inline-flex">
            {connected ? 'GitHub connected' : 'GitHub disconnected'}
          </Badge>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSync}
            loading={busy}
            disabled={busy || !connected}
            className="hidden sm:inline-flex"
          >
            {syncing ? 'Syncing…' : conflict ? 'Sync now (conflict)' : 'Sync now'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSync}
            loading={busy}
            disabled={busy || !connected}
            aria-label="Sync now"
            className="sm:hidden"
          >
            {syncing ? '…' : 'Sync'}
          </Button>
          <AvatarMenu />
        </div>
      </header>
      <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />
    </>
  );
}
