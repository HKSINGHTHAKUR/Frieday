import { useState, useEffect } from 'react';
import { apiGet } from '../lib/apiClient.js';

/**
 * useSyncStatus — polls /api/sync/status while sync is active.
 * - Polls every ~2 seconds while sync is active
 * - Stops polling when sync completes or errors
 * - No perpetual polling
 * - Cleans up timers on unmount
 */
export function useSyncStatus() {
  const [status, setStatus] = useState('idle');
  const [phase, setPhase] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let timer = null;

    async function tick() {
      let data = null;
      try {
        data = await apiGet('/api/sync/status');
      } catch {
        data = null;
      }
      if (!mounted) return;
      if (!data) {
        setError({ message: 'Failed to load sync status', retryable: true });
        setLoading(false);
        return;
      }
      setError(null);
      setStatus(data.status || 'idle');
      setPhase(data.phase || null);
      setProgress({ done: data.done || 0, total: data.total || 0 });
      // Server statuses (sync.service.js): queued | running | succeeded |
      // failed | cancelled | idle. Poll only while active; stop on terminal.
      if (data.status === 'queued' || data.status === 'running') {
        timer = setTimeout(tick, 2000);
      } else {
        setLoading(false);
      }
    }

    tick();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { status, phase, progress, error, loading };
}

export default useSyncStatus;
