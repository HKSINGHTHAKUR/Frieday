import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../lib/apiClient.js';

/**
 * useInsights — GET /api/insights?range=. Returns stored deterministic
 * insights as-is; the frontend never recomputes them.
 */
export function useInsights(range) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet(`/api/insights?range=${range}`);
      setInsights(Array.isArray(payload?.insights) ? payload.insights : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return { insights, loading, error, refetch: fetchInsights };
}

export default useInsights;
