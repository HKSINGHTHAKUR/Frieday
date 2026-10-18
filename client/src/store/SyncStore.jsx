/**
 * Sync store (T5.3 global sync UX). One shared poller for GET /api/sync/status:
 * 2s while a job is queued/running, one initial read otherwise, no perpetual
 * polling. `startSync` wraps POST /api/sync and surfaces the documented 409
 * SYNC_CONFLICT instead of creating duplicate jobs. Progress facts come only
 * from the status payload — never fabricated client-side.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/apiClient.js';

export const SyncContext = createContext(null);

const POLL_MS = 2000;
const ACTIVE_STATUSES = new Set(['queued', 'running']);

const INITIAL = {
  status: 'idle',
  jobId: null,
  kind: null,
  phase: null,
  done: 0,
  total: 0,
  perResource: {},
  counts: {},
  resources: {},
  history: [],
  error: null,
  resumeAt: null,
  startedAt: null,
  finishedAt: null,
  loading: true,
};

export function SyncProvider({ children }) {
  const [data, setData] = useState(INITIAL);
  const [conflict, setConflict] = useState(null);
  const [starting, setStarting] = useState(false);
  const mountedRef = useRef(true);

  const applyStatus = useCallback((payload) => {
    if (!mountedRef.current || !payload) return false;
    setData({ ...INITIAL, ...payload, loading: false });
    return ACTIVE_STATUSES.has(payload.status);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let timer = null;

    async function tick() {
      let payload = null;
      try {
        payload = await apiGet('/api/sync/status');
      } catch {
        payload = null;
      }
      if (!mountedRef.current) return;
      if (!payload) {
        setData((s) => ({ ...s, loading: false }));
        return;
      }
      const active = applyStatus(payload);
      if (active) timer = setTimeout(tick, POLL_MS);
    }

    tick();

    return () => {
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [applyStatus]);

  const startSync = useCallback(async () => {
    setStarting(true);
    setConflict(null);
    try {
      const out = await apiPost('/api/sync');
      if (mountedRef.current && out) {
        applyStatus({ ...out, resources: out.resources ?? {}, history: out.history ?? [] });
      }
      return { ok: true };
    } catch (err) {
      if (err && err.code === 'SYNC_CONFLICT') {
        setConflict(err.message || 'A sync is already running.');
        // Surface the running job's progress instead of fabricating a new one.
        try {
          const status = await apiGet('/api/sync/status');
          applyStatus(status);
        } catch {
          // Status read failed; the conflict flag still informs the UI.
        }
        return { ok: false, conflict: true, message: err.message };
      }
      return { ok: false, error: err };
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, [applyStatus]);

  const value = useMemo(
    () => ({ ...data, conflict, starting, startSync, refreshNow: applyStatus }),
    [data, conflict, starting, startSync, applyStatus]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  return useContext(SyncContext);
}
