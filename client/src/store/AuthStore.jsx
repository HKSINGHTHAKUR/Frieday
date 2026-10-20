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
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiDelete, setSessionRefresher } from '../lib/apiClient.js';
import { safeNavigate } from '../lib/safeNavigate.js';

export const AuthContext = createContext(null);

const INITIAL = { status: 'loading', user: null, connected: null, lastSyncedAt: null, error: null };

// Module scope: survives provider remounts within a page load.
// Single-flight guards so React StrictMode double-invocation (or concurrent
// route entries) cannot fire overlapping session probes or rotations.
let inFlightRefresh = null;
let inFlightLoadMe = null;

export function AuthProvider({ children }) {
  const [shared, setShared] = useState(INITIAL);
  const navigate = useNavigate();

  const markSessionLost = useCallback(() => {
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
    if (!inFlightLoadMe) {
      inFlightLoadMe = (async () => {
        try {
          // apiClient already attempts one rotation on 401 before surfacing this.
          const me = await apiGet('/api/auth/me');
          setShared({
            status: 'authenticated',
            user: me.user,
            connected: me.connected,
            lastSyncedAt: me.lastSyncedAt,
            error: null,
          });
        } catch (err) {
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
          inFlightLoadMe = null;
        }
      })();
    }
    return inFlightLoadMe;
  }, []);

  useEffect(() => {
    setSessionRefresher(refreshSession);
    return () => setSessionRefresher(null);
  }, [refreshSession]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      // The session is already gone server-side; the clear below still applies.
    }
    markSessionLost();
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
    () => ({ ...shared, logout, disconnect, deleteData, loadMe, refreshSession }),
    [shared, logout, disconnect, deleteData, loadMe, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
