import { useCallback, useState } from 'react';
import { apiGet } from '../lib/apiClient.js';

const PAGE_SIZE = 50;

/**
 * useRepos — GET /api/repos?sort=&limit=&cursor=&includeThemes= with cursor
 * pagination. Pages accumulate in order; "next" appends using the API's
 * nextCursor. (The cursor contract has no previous-page token — the list is
 * reloaded from the first page instead.)
 *
 * Phase 10.2: the response also carries `repoThemes` — a map of repoId ->
 * per-repository commit-theme analysis, delivered in the SAME response so the
 * client never issues one request per repository. Pages accumulate; the map
 * is merged page by page. The map is opt-in on the server
 * (`includeThemes=true`) because it is the largest part of the response.
 */
export function useRepos() {
  const [items, setItems] = useState([]);
  const [repoThemes, setRepoThemes] = useState({});
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
      const params = new URLSearchParams({ sort, limit: String(PAGE_SIZE), includeThemes: 'true' });
      if (nextCursor) params.set('cursor', nextCursor);
      const payload = await apiGet(`/api/repos?${params.toString()}`);
      const page = Array.isArray(payload?.items) ? payload.items : [];
      setItems((prev) => (append ? [...prev, ...page] : page));
      const pageThemes =
        payload?.repoThemes && typeof payload.repoThemes === 'object' ? payload.repoThemes : {};
      setRepoThemes((prev) => (append ? { ...prev, ...pageThemes } : { ...pageThemes }));
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

  return { items, repoThemes, hasMore, loading, loadingMore, error, reload, loadMore };
}

export default useRepos;
