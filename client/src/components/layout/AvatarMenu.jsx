import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import { useAuth } from '../../hooks/useAuth.js';

/**
 * Topbar avatar + account menu (design_system.md §14: avatar menu with
 * Settings, Disconnect, Logout). Closes on outside click / Escape; the
 * destructive disconnect is confirmed via Modal (rules.md: destructive needs
 * confirm).
 */
export default function AvatarMenu() {
  const { user, logout, disconnect } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);
  const initials = user ? (user.login || '?').slice(0, 1).toUpperCase() : '?';

  const handleLogout = async () => {
    close();
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await disconnect();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border border-border bg-surface2"
      >
        {user && user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm font-semibold text-text2">{initials}</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          // Anchored to the avatar's right edge so the menu grows leftward
          // into the viewport instead of off-screen. `max-w` keeps it inside
          // narrow viewports; item labels wrap rather than clip.
          className="absolute right-0 top-full z-50 mt-8 w-56 max-w-[calc(100vw-32px)] rounded-md border border-border bg-surface p-8 shadow-md"
        >
          <div className="border-b border-border pb-8">
            <p className="truncate text-sm font-medium text-text">{user ? user.login : '…'}</p>
            <p className="text-xs text-text3">GitHub account</p>
          </div>
          <div className="flex flex-col pt-4">
            <Link
              role="menuitem"
              to="/settings"
              onClick={close}
              className="rounded-sm px-8 py-8 text-sm font-medium text-text2 hover:bg-surface2"
            >
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                setConfirming(true);
              }}
              className="rounded-sm px-8 py-8 text-left text-sm font-medium text-danger hover:bg-surface2"
            >
              Disconnect GitHub
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              disabled={busy}
              className="rounded-sm px-8 py-8 text-left text-sm font-medium text-text2 hover:bg-surface2 disabled:opacity-40"
            >
              {busy ? 'Working…' : 'Logout'}
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <Modal title="Disconnect GitHub?" onClose={() => (busy ? undefined : setConfirming(false))}>
          <p className="text-sm text-text2">
            This revokes Frieday&apos;s access to your GitHub account. You stay signed in to Frieday; your
            synced data is kept until you delete it.
          </p>
          <div className="mt-24 flex justify-end gap-8">
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDisconnect} loading={busy}>
              Disconnect
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
