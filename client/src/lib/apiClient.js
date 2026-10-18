/**
 * apiClient — the ONLY way frontend code talks to the backend (rules.md §17).
 * Cookies carry auth (`credentials: include`); the client never sees tokens.
 * Server errors arrive as { error: { code, message, details?, retryable } }.
 *
 * 401 handling (T1.3, architecture.md §5/§13): a protected request that comes
 * back UNAUTHENTICATED triggers one session rotation via the registered
 * refresher (`POST /api/auth/refresh`, called by the auth store) and retries
 * the original request exactly once. Auth endpoints never auto-refresh
 * (no recursion); a failed rotation surfaces the original 401 so the store
 * can clear the session and route to /login.
 */

const ENV = import.meta.env ?? {};
const BASE_URL = ENV.VITE_API_URL ?? '';

// Endpoints that must never trigger the refresh-then-retry path: the refresh
// call itself (recursion) and the session teardown actions (their 401 means
// the session is already gone).
const NO_REFRESH_PATHS = new Set([
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/disconnect',
  '/api/auth/github',
  '/api/auth/github/callback',
]);

const RETRIED = Symbol('apiClient:retried');

export class ApiError extends Error {
  /**
   * @param {{ code?: string, message?: string, retryable?: boolean, status?: number }} parts
   */
  constructor(parts = {}) {
    super(parts.message ?? 'Something went wrong.');
    this.name = 'ApiError';
    this.code = parts.code ?? 'UNKNOWN';
    this.retryable = parts.retryable ?? false;
    this.status = parts.status ?? 0;
  }
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   baseUrl?: string,
 *   refresher?: () => Promise<boolean>,
 * }} [deps] refresher is called once per failed 401; true = session rotated
 * (original request retried once), false = session lost (error propagates).
 *   Callers that fire many requests concurrently must single-flight it
 *   (the auth store does).
 */
export function createApiClient({ fetchImpl = fetch, baseUrl = '', refresher = null } = {}) {
  /**
   * @param {string} path `/api/...` path
   * @param {RequestInit} [options] fetch options (method/body/headers merged)
   * @returns {Promise<any>} parsed JSON (or null for 204)
   * @throws {ApiError} typed error from the server envelope or network failure
   */
  async function apiRequest(path, options = {}) {
    const headers = options.headers
      ? { 'Content-Type': 'application/json', ...options.headers }
      : { 'Content-Type': 'application/json' };
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { credentials: 'include', ...options, headers });
    } catch {
      throw new ApiError({ code: 'NETWORK_ERROR', message: 'Could not reach the server.', retryable: true });
    }

    if (res.status === 204) {
      return null;
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      throw new ApiError({ code: 'BAD_RESPONSE', message: 'Invalid server response.', status: res.status });
    }

    if (!res.ok) {
      const error = new ApiError({
        code: body?.error?.code ?? 'UNKNOWN',
        message: body?.error?.message ?? 'Something went wrong.',
        retryable: body?.error?.retryable ?? false,
        status: res.status,
      });
      if (
        error.status === 401 &&
        error.code === 'UNAUTHENTICATED' &&
        refresher &&
        !options[RETRIED] &&
        !NO_REFRESH_PATHS.has(path)
      ) {
        const rotated = await refresher();
        if (rotated) {
          return apiRequest(path, { ...options, [RETRIED]: true });
        }
      }
      throw error;
    }
    return body;
  }

  /** @param {string} path */
  function apiGet(path) {
    return apiRequest(path, { method: 'GET' });
  }

  /** @param {string} path @param {unknown} [payload] */
  function apiPost(path, payload) {
    return apiRequest(path, {
      method: 'POST',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  /** @param {string} path */
  function apiDelete(path) {
    return apiRequest(path, { method: 'DELETE' });
  }

  return { apiRequest, apiGet, apiPost, apiDelete };
}

// Default singleton: bound to the page's global fetch and the session
// refresher registered by the auth store (registered once per app load).
const refresherRef = { current: null };
export function setSessionRefresher(fn) {
  refresherRef.current = fn ?? null;
}

const defaultClient = createApiClient({
  baseUrl: BASE_URL,
  refresher: () => (refresherRef.current ? refresherRef.current() : Promise.resolve(false)),
});

export const { apiRequest, apiGet, apiPost, apiDelete } = defaultClient;
