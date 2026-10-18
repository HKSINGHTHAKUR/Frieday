import { useCallback, useState } from 'react';
import { apiGet } from '../lib/apiClient.js';

const PAGE_SIZE = 50;

/**
 * useRepos — GET /api/repos?sort=&limit=&cursor= with cursor pagination.
 * Pages accumulate in order; "next" appends using the API's nextCursor.
 * (The cursor contract has no previous-page token — the list is reloaded
 * from the first page instead.)
 */
export function useRepos() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const fetchPage = useCallback(async ({ sort, nextCursor, append }) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({ sort, limit: String(PAGE_SIZE) });
      if (nextCursor) params.set('cursor', nextCursor);
      const payload = await apiGet(`/api/repos?${params.toString()}`);
      const page = Array.isArray(payload?.items) ? payload.items : [];
      setItems((prev) => (append ? [...prev, ...page] : page));
      setCursor(payload?.nextCursor ?? null);
      setHasMore(Boolean(payload?.hasMore));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const reload = useCallback((sort) => fetchPage({ sort, nextCursor: null, append: false }), [fetchPage]);

  const loadMore = useCallback(
    (sort) => {
      if (!cursor) return undefined;
      return fetchPage({ sort, nextCursor: cursor, append: true });
    },
    [cursor, fetchPage]
  );

  return { items, hasMore, loading, loadingMore, error, reload, loadMore };
}

export default useRepos;
