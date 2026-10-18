/**
 * In-process memo cache (T5.1) — 60-second TTL, LRU-ish eviction, 500 entry max.
 *
 * Key format: `${scope}:${userId}:${range}:${granularity}:${lastSyncedAt}`
 * - scope: API entity ('dashboard' | 'insights' | 'timeline') so routes that
 *   cache different-shaped values for the same (userId, range, lastSyncedAt)
 *   never collide (e.g. dashboard's full payload vs insights' { insights }).
 * - userId: user ObjectId string
 * - range: '30d' | '90d' | '12m'
 * - granularity: 'day' | 'week' (timeline granularity dimension, so day and
 *   week payloads for the same range never collide; '' for dashboard reads)
 * - lastSyncedAt: ISO timestamp from SyncState (lastSyncedAt)
 *
 * Pure in-process Map, no Redis. Max 500 entries with LRU-ish eviction.
 *
 * Not a replacement for T4.3 SyncState-based cache — this is an API-layer
 * memo to avoid recomputing the same payload within 60 seconds when the
 * underlying data hasn't changed.
 */

const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_MAX_ENTRIES = 500;

const cache = new Map();

/**
 * Generate cache key.
 * @param {string} scope - API entity namespace ('dashboard' | 'insights' | 'timeline')
 * @param {string} userId
 * @param {string} range
 * @param {string} lastSyncedAt - ISO timestamp string
 * @param {string} [granularity] - 'day' | 'week' (optional; '' when absent)
 */
function makeKey(scope, userId, range, lastSyncedAt, granularity) {
  return `${scope ?? ''}:${userId}:${range}:${granularity ?? ''}:${lastSyncedAt}`;
}

/**
 * Get cached value if valid.
 * @returns {any|null} cached value or null if miss/expired
 */
function get(scope, userId, range, lastSyncedAt, granularity) {
  const key = makeKey(scope, userId, range, lastSyncedAt, granularity);
  const entry = cache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  // Update access time for LRU
  entry.timestamp = now;
  return entry.value;
}

/**
 * Set cache entry.
 * Evicts oldest entries if over limit.
 */
function set(scope, userId, range, lastSyncedAt, value, granularity) {
  const key = makeKey(scope, userId, range, lastSyncedAt, granularity);

  // Evict oldest if at capacity
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(key)) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, v] of cache.entries()) {
      if (v.timestamp < oldestTime) {
        oldestTime = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(key, { value, timestamp: Date.now() });
}

/**
 * Invalidate cache entries for a user (optional, for explicit invalidation).
 */
function invalidateUser(userId) {
  for (const key of cache.keys()) {
    if (key.split(':')[1] === userId) {
      cache.delete(key);
    }
  }
}

/**
 * Clear all cache entries.
 */
function clear() {
  cache.clear();
}

module.exports = {
  get,
  set,
  invalidateUser,
  clear,
  CACHE_TTL_MS,
  CACHE_MAX_ENTRIES,
};
