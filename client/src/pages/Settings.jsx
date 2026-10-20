import { useEffect, useState } from 'react';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Modal from '../components/ui/Modal.jsx';
import SyncSettings from '../components/domain/SyncSettings.jsx';
import { formatAgo } from '../lib/format.js';
import { aiExplanationsEnabled, setAiExplanationsEnabled } from '../lib/aiPrefs.js';
import { useAuth } from '../hooks/useAuth.js';
import { useSync } from '../store/SyncStore.jsx';

/**
 * Most recent successful resource sync across the live sync status — mirrors
 * the server's canonical overall value (sync.store.overallLastSyncedAt, used
 * by GET /api/auth/me). The per-resource rows already come from the live
 * GET /api/sync/status; deriving the top-level from the same data keeps the
 * ConnectionCard consistent with them after a resync, instead of holding the
 * boot-time /me snapshot.
 * @param {Record<string, {lastSyncedAt?: string|null}|undefined>|undefined} resources
 * @returns {number|null} ms timestamp of the most recent successful resource sync
 */
export function overallLastSyncedAt(resources) {
  let max = null;
  for (const state of Object.values(resources ?? {})) {
    const t = state?.lastSyncedAt ? new Date(state.lastSyncedAt).getTime() : null;
    if (t !== null && (max === null || t > max)) max = t;
  }
  return max;
}

/**
 * Settings (tasks.md T1.3 + T5.3): GitHub connection state — login, scopes,
 * token status, last synced — plus Resync (single-flight, 409-aware), sync
 * history, Disconnect (confirmed) and Delete data (separate destructive
 * confirm). Reconnect covers the 401/expired-token path (prd.md §20).
 */
export default function Settings() {
  const { user, connected, lastSyncedAt, logout, disconnect, deleteData } = useAuth();
  const { resources } = useSync();
  const overallLastSynced = overallLastSyncedAt(resources) ?? lastSyncedAt;
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await disconnect();
    } finally {
      setBusy(false);
      setConfirmingDisconnect(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteData();
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-24">
      <h1 className="text-xl font-bold text-text">Settings</h1>

      <ConnectionCard
        user={user}
        connected={connected}
        lastSyncedAt={overallLastSynced}
        onDisconnect={() => setConfirmingDisconnect(true)}
      />
      <SyncSettings connected={connected} />
      <AiPreferenceCard />
      <Card title="Session">
        <p className="text-sm text-text2">
          Sign out of Frieday on this device. The session cookie is cleared; your GitHub data is not touched.
        </p>
        <div className="mt-16">
          <Button variant="secondary" size="sm" onClick={handleLogout} loading={busy}>
            Sign out
          </Button>
        </div>
      </Card>
      <DataCard onDelete={() => setConfirmingDelete(true)} />

      {confirmingDisconnect && (
        <Modal title="Disconnect GitHub?" onClose={() => (busy ? undefined : setConfirmingDisconnect(false))}>
          <p className="text-sm text-text2">
            This revokes Frieday&apos;s access to your GitHub account. You stay signed in to Frieday; your
            synced data is kept until you delete it.
          </p>
          <div className="mt-24 flex justify-end gap-8">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmingDisconnect(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDisconnect} loading={busy}>
              Disconnect
            </Button>
          </div>
        </Modal>
      )}

      {confirmingDelete && (
        <Modal
          title="Delete all synced data?"
          onClose={() => (busy ? undefined : setConfirmingDelete(false))}
        >
          <p className="text-sm text-text2">
            This permanently deletes every synced and derived record tied to your account — repositories,
            commits, pull requests, issues, languages, and insights — and ends your session. This cannot be
            undone; reconnecting starts from scratch.
          </p>
          <div className="mt-24 flex justify-end gap-8">
            <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete} loading={busy}>
              Delete everything
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ConnectionCard({ user, connected, lastSyncedAt, onDisconnect }) {
  if (!connected) {
    return (
      <Card title="GitHub connection">
        <div role="alert" className="rounded-md border border-danger bg-dangerBg p-16">
          <p className="text-sm font-medium text-danger">GitHub connection expired.</p>
          <p className="mt-4 text-sm text-text2">
            The connection to your GitHub account was revoked or no longer available.
          </p>
        </div>
        <div className="mt-16">
          <a
            href="/api/auth/github"
            className="inline-flex h-36 items-center justify-center rounded-sm bg-accent px-16 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Reconnect
          </a>
        </div>
      </Card>
    );
  }

  return (
    <Card title="GitHub connection">
      <div className="flex flex-col gap-16">
        <div className="flex items-center gap-12">
          {user && user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-48 w-48 rounded-full border border-border object-cover"
            />
          ) : (
            <span className="flex h-48 w-48 items-center justify-center rounded-full bg-surface2 text-lg font-semibold text-text2">
              {user ? user.login.slice(0, 1).toUpperCase() : '?'}
            </span>
          )}
          <div className="min-w-0">
            <a
              href={user ? user.profileUrl : undefined}
              target="_blank"
              rel="noreferrer"
              className="text-base font-semibold text-accent underline-offset-2 hover:underline"
            >
              {user ? user.login : '—'}
            </a>
            <p className="mt-4 flex items-center gap-8 text-sm text-text2">
              <Badge tone="success">Token active</Badge>
              {lastSyncedAt ? `Last synced ${formatAgo(lastSyncedAt)}` : 'Not synced yet'}
            </p>
          </div>
        </div>
        {user && Array.isArray(user.scopes) && user.scopes.length > 0 && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-text3">Granted scopes</h3>
            <div className="mt-8 flex flex-wrap gap-8">
              {user.scopes.map((scope) => (
                <Badge key={scope} tone="neutral" className="mono">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-8">
          <Button variant="danger" size="sm" onClick={onDisconnect}>
            Disconnect GitHub
          </Button>
          <p className="text-xs text-text3">
            Revokes the GitHub token. You stay signed in; data is kept until deleted.
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * AI preference (T6.2, prd.md §19 "User can disable AI in settings").
 * Non-secret client-side preference; disabling only stops explanation
 * requests — deterministic insights and synced data are unaffected.
 */
function AiPreferenceCard() {
  const [enabled, setEnabled] = useState(aiExplanationsEnabled());

  useEffect(() => {
    const sync = () => setEnabled(aiExplanationsEnabled());
    window.addEventListener('frieday:ai-preference-changed', sync);
    return () => window.removeEventListener('frieday:ai-preference-changed', sync);
  }, []);

  return (
    <Card title="AI explanations">
      <div className="flex items-start gap-12">
        <input
          id="ai-explanations-toggle"
          type="checkbox"
          checked={enabled}
          onChange={(event) => setAiExplanationsEnabled(event.target.checked)}
          className="mt-4 h-16 w-16 rounded-sm border border-borderStrong accent-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div>
          <label htmlFor="ai-explanations-toggle" className="text-sm font-medium text-text">
            Enable AI explanations (beta)
          </label>
          <p className="mt-4 text-xs text-text3">
            When on, the Explain button on an insight can request a short AI-written paraphrase of the
            computed summary. When off, no AI request is made — your deterministic insights, metrics, and
            synced GitHub data are unaffected either way.
          </p>
        </div>
      </div>
    </Card>
  );
}

function DataCard({ onDelete }) {
  return (
    <Card title="Data">
      <p className="text-sm text-text2">
        Delete every synced and derived record for your account. This is separate from Disconnect: it cannot
        be undone, and reconnecting starts from scratch.
      </p>
      <div className="mt-16">
        <Button variant="danger" size="sm" onClick={onDelete}>
          Delete all data
        </Button>
      </div>
    </Card>
  );
}
