import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet } from '../lib/apiClient.js';

const RANGES = ['30d', '90d', '12m'];
const DEFAULT_RANGE = '30d';

/**
 * useDashboard — fetches dashboard intelligence payload.
 * - Syncs `range` with URL search params
 * - Uses apiClient (credentials: include, auto-refresh on 401)
 * - Returns loading/error/data + range setter
 */
export function useDashboard(_initialRange = DEFAULT_RANGE) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet(`/api/dashboard?range=${range}`);
      setData(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
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
