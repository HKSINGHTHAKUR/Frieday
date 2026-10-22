import { isSafeNavigateTarget } from './safeNavigate.js';

/**
 * Return destination — where to send the user after a successful sign-in.
 *
 * An unauthenticated user who deep-links to a protected route (e.g.
 * `/repositories`) is redirected to `/login`. Without a stored destination
 * they land on the dashboard afterwards and lose their place. The intended
 * destination is carried in the `?next=` query parameter, which is
 * attacker-controllable, so it is validated with the SAME guard used for
 * every other navigation target (`isSafeNavigateTarget`).
 *
 * The rules:
 *   - only a same-origin relative path beginning with `/` is accepted;
 *   - `/login` is never a valid destination (it would loop);
 *   - an external URL, a protocol-relative URL (`//evil.com`), a
 *     backslash UNC path, or a `javascript:`/`data:` scheme is rejected and
 *     the caller falls back to the dashboard.
 */

const NEXT_PARAM = 'next';
const DEFAULT_DESTINATION = '/';

/** sessionStorage key for the destination that survives the OAuth round-trip. */
const PENDING_KEY = 'fd:pending-destination';

/**
 * Remember where the user was heading, so it can be restored after the OAuth
 * round-trip.
 *
 * The OAuth flow is a FULL page navigation (out to the provider and back),
 * so the `?next=` query parameter is lost on the way. sessionStorage carries
 * it across, and it is scoped to the tab — a second tab signing in does not
 * steal this tab's destination.
 *
 * Only a route is stored — never a token, a session id or any credential
 * (rules.md §16).
 *
 * @param {string} destination the route the user was trying to reach
 */
export function setPendingDestination(destination) {
  const safe = sanitizeReturnDestination(destination);
  try {
    if (safe === DEFAULT_DESTINATION) window.sessionStorage.removeItem(PENDING_KEY);
    else window.sessionStorage.setItem(PENDING_KEY, safe);
  } catch {
    // sessionStorage can be unavailable (private mode, blocked storage).
    // The destination is a nicety; the flow must still work without it.
  }
}

/**
 * Read (and clear) the remembered destination.
 * @returns {string} a safe relative path, or '/' when there is none
 */
export function takePendingDestination() {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    return sanitizeReturnDestination(raw);
  } catch {
    return DEFAULT_DESTINATION;
  }
}

/**
 * Read the intended destination from a query string.
 * @param {string} search a `location.search` value
 * @returns {string} a safe relative path, or '/' when there is none
 */
export function readReturnDestination(search) {
  let raw = null;
  try {
    raw = new URLSearchParams(search || '').get(NEXT_PARAM);
  } catch {
    return DEFAULT_DESTINATION;
  }
  return sanitizeReturnDestination(raw);
}

/**
 * Validate a candidate destination.
 * @param {string | null | undefined} raw
 * @returns {string} a safe relative path, or '/' when the candidate is unusable
 */
export function sanitizeReturnDestination(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_DESTINATION;
  // `isSafeNavigateTarget` rejects absolute URLs, protocol-relative URLs,
  // backslash paths and unknown schemes.
  if (!isSafeNavigateTarget(raw)) return DEFAULT_DESTINATION;
  // The login page itself is not a destination — that would loop.
  if (raw === '/login' || raw.startsWith('/login?')) return DEFAULT_DESTINATION;
  return raw;
}

/**
 * Build the login URL that carries the intended destination.
 * @param {string} destination the route the user was trying to reach
 * @returns {string} e.g. `/login?next=%2Frepositories`
 */
export function buildLoginUrl(destination) {
  const safe = sanitizeReturnDestination(destination);
  if (safe === DEFAULT_DESTINATION) return '/login';
  return `/login?${NEXT_PARAM}=${encodeURIComponent(safe)}`;
}

export { NEXT_PARAM, DEFAULT_DESTINATION, PENDING_KEY };
