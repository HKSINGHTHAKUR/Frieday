/**
 * Auth store (tasks.md T1.3; rules.md §17: React context + hooks, one
 * approach). Session state comes from the httpOnly cookie pair — the client
 * never sees, stores, or passes around tokens (rules.md §16).
 *
 * States:
 * - loading: initial GET /api/auth/me probe (no app shell rendered yet, so an
 *   unauthenticated user never flickers through the dashboard).
 * - authenticated: user + connection facts from /me.
 * - unauthenticated: no session, or session lost (refresh failed) → the gate
 *   routes to /login (full-page, prd.md §20).
 * - error: /me failed for a non-auth reason (network/server) → retryable
 *   full-page card, NOT treated as session loss.
 *
 * Session rotation: `refreshSession` is the refresher registered with
 * apiClient — on any 401 it runs POST /api/auth/refresh once (single-flight,
 * module-scoped so React StrictMode double-invocation can never double-post
 * a rotation, which would trip the server's refresh-reuse detection).
 */
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiDelete, setSessionRefresher } from '../lib/apiClient.js';
import { safeNavigate } from '../lib/safeNavigate.js';

export const AuthContext = createContext(null);

const INITIAL = { status: 'loading', user: null, connected: null, lastSyncedAt: null, error: null };

// Module scope: survives provider remounts within a page load.
// Single-flight guard so React StrictMode double-invocation (or concurrent
// route entries) cannot fire overlapping session ROTATIONS. The server
// treats a replayed refresh token as a stolen session, so a second rotation
// would log the user out — this must be a true single flight.
//
// The session PROBE is guarded per provider instance instead (see the ref
// below): a probe is idempotent, and a remounted provider must not inherit a
// pending probe from a provider that no longer exists.
let inFlightRefresh = null;

/**
 * Generation counter for the session probe.
 *
 * A probe that was already in flight when the user logged out must NOT be
 * allowed to publish its result: it would resurrect the very session that was
 * just invalidated and re-render the protected UI. Bumping the generation
 * invalidates every probe that started before it.
 */
let sessionGeneration = 0;

export function AuthProvider({ children }) {
  const [shared, setShared] = useState(INITIAL);
  // True while a history-navigation revalidation is in flight. The app shows
  // the neutral loading screen during it, so protected content is never
  // rendered for a session that may already be gone.
  const [revalidating, setRevalidating] = useState(false);
  // The in-flight session probe for THIS provider instance.
  const inFlightLoadMe = useRef(null);
  const navigate = useNavigate();

  const markSessionLost = useCallback(() => {
    // Invalidate any probe that is already running.
    sessionGeneration += 1;
    setShared({ ...INITIAL, status: 'unauthenticated' });
  }, []);

  const refreshSession = useCallback(async () => {
    if (!inFlightRefresh) {
      inFlightRefresh = apiPost('/api/auth/refresh')
        .then(() => true)
        .catch(() => {
          markSessionLost();
          return false;
        })
        .finally(() => {
          inFlightRefresh = null;
        });
    }
    return inFlightRefresh;
  }, [markSessionLost]);

  const loadMe = useCallback(async () => {
    if (!inFlightLoadMe.current) {
      const generation = sessionGeneration;
      inFlightLoadMe.current = (async () => {
        try {
          // apiClient already attempts one rotation on 401 before surfacing this.
          const me = await apiGet('/api/auth/me');
          // A newer generation means the session was invalidated (logout) while
          // this probe was in flight. Publishing now would resurrect it.
          if (generation !== sessionGeneration) return;
          setShared({
            status: 'authenticated',
            user: me.user,
            connected: me.connected,
            lastSyncedAt: me.lastSyncedAt,
            error: null,
          });
        } catch (err) {
          if (generation !== sessionGeneration) return;
          if (err && err.status === 401 && err.code === 'UNAUTHENTICATED') {
            setShared({ ...INITIAL, status: 'unauthenticated' });
          } else {
            setShared((s) => ({
              ...s,
              status: 'error',
              error: (err && err.message) || 'Could not load your session.',
            }));
          }
        } finally {
          inFlightLoadMe.current = null;
        }
      })();
    }
    return inFlightLoadMe.current;
  }, []);

  useEffect(() => {
    setSessionRefresher(refreshSession);
    return () => setSessionRefresher(null);
  }, [refreshSession]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  /**
   * Re-validate the session when the user navigates through browser history
   * or restores a page from the back-forward cache.
   *
   * WHY: the session probe runs once per document load. A same-document
   * history navigation (React Router's push) does NOT reload the document, so
   * the client keeps whatever it last knew about the session. After a logout
   * — or a session that expired in another tab — Back could therefore render
   * the protected dashboard with stale, private data while the server session
   * is already gone.
   *
   * `popstate` covers same-document history moves; `pageshow` with
   * `persisted: true` covers a back-forward-cache restore (where React is not
   * re-mounted at all, so no effect would otherwise run).
   *
   * The probe is the SAME single-flight `loadMe` used at boot, so there is
   * never more than one request in flight, and a stale response can never
   * overwrite newer state.
   *
   * While the probe is in flight the app renders the neutral loading screen
   * rather than the previous page's content: the protected UI must never be
   * shown for a session that may no longer exist.
   */
  useEffect(() => {
    const revalidate = () => {
      setRevalidating(true);
      loadMe().finally(() => setRevalidating(false));
    };
    const onPageShow = (event) => {
      // `persisted: true` means the page was restored from the bfcache: the
      // document (and its React tree) was NOT re-created, so the boot probe
      // never ran and the session state may be stale.
      if (event.persisted) revalidate();
    };
    window.addEventListener('popstate', revalidate);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('popstate', revalidate);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [loadMe]);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      // The session is already gone server-side; the clear below still applies.
    }
    markSessionLost();
    // REPLACE, not push: the protected route the user was on must not stay in
    // the history stack, otherwise Back would return to it. (The revalidation
    // on popstate would then bounce it to /login, but replacing avoids the
    // pointless extra hop and the flash of the protected shell.)
    safeNavigate(navigate, '/login', { replace: true });
  }, [markSessionLost, navigate]);

  const disconnect = useCallback(async () => {
    try {
      const result = await apiPost('/api/auth/disconnect');
      // Disconnect keeps the Frieday session alive — only the GitHub
      // integration is severed. Refresh /me so the UI reflects the
      // disconnected state without signing the user out.
      if (result && result.disconnected) {
        await loadMe();
      }
    } catch {
      // Best-effort: even if the request failed, try to sync state from /me.
      try {
        await loadMe();
      } catch {
        // If /me also fails, the session may be genuinely lost — surface it.
        markSessionLost();
      }
    }
  }, [markSessionLost, loadMe]);

  const deleteData = useCallback(async () => {
    // Full wipe (DELETE /api/auth/data): server deletes the user document too,
    // so the session is dead afterwards regardless of the response.
    try {
      await apiDelete('/api/auth/data');
    } catch {
      // Best-effort: the wipe already ran or the session was gone; cookies are
      // cleared by the server response path. Never block the route to /login.
    }
    markSessionLost();
    safeNavigate(navigate, '/login', { replace: true });
  }, [markSessionLost, navigate]);

  const value = useMemo(
    () => ({
      ...shared,
      revalidating,
      logout,
      disconnect,
      deleteData,
      loadMe,
      refreshSession,
    }),
    [shared, revalidating, logout, disconnect, deleteData, loadMe, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
