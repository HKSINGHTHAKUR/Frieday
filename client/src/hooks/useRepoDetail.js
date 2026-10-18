import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../lib/apiClient.js';

/**
 * useRepoDetail — GET /api/repos/:id?range=. A 404 (NOT_FOUND) is kept as a
 * distinct `notFound` flag so the page can render the safe
 * "no longer accessible" state without leaking cross-user information.
 */
export function useRepoDetail(id, range) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const payload = await apiGet(`/api/repos/${id}?range=${range}`);
      setData(payload);
    } catch (err) {
      if (err && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [id, range]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return { data, loading, error, notFound, refetch: fetchDetail };
}

export default useRepoDetail;
