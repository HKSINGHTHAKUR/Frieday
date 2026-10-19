import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet } from '../lib/apiClient.js';

const RANGES = ['30d', '90d', '12m'];
const DEFAULT_RANGE = '30d';

/**
 * useDashboard — fetches dashboard intelligence payload.
 * - Syncs `range` with URL search params
 * - Uses apiClient (credentials: include, auto-refresh on 401)
 * - Returns loading/error/data + range setter
 * - In-flight request dedup: only the latest range's response updates state,
 *   so rapid range changes (30d → 90d → 12m) never display stale data from an
 *   earlier, slower request (T5.2 range-switching stability fix).
 */
export function useDashboard(_initialRange = DEFAULT_RANGE) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const latestRequest = useRef(0);

  // Initialize range from URL or default
  const range = useMemo(() => {
    const urlRange = searchParams.get('range');
    return RANGES.includes(urlRange) ? urlRange : DEFAULT_RANGE;
  }, [searchParams]);

  const setRange = useCallback(
    (newRange) => {
      if (!RANGES.includes(newRange)) return;
      setSearchParams({ range: newRange }, { replace: true });
    },
    [setSearchParams]
  );

  const fetchDashboard = useCallback(async () => {
    latestRequest.current += 1;
    const requestId = latestRequest.current;

    setLoading(true);
    setError(null);
    try {
      const data = await apiGet(`/api/dashboard?range=${range}`);
      // Discard stale responses from superseded range changes.
      if (requestId !== latestRequest.current) return;
      setData(data);
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setError(err);
    } finally {
      if (requestId === latestRequest.current) {
        setLoading(false);
      }
    }
  }, [range]);

  // Fetch on range change
  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Refetch function for manual refresh
  const refetch = useCallback(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return {
    range,
    setRange,
    data,
    loading,
    error,
    refetch,
  };
}

export default useDashboard;
