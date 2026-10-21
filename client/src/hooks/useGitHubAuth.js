import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet } from '../lib/apiClient.js';

/**
 * useGitHubAuth — drives the REAL Frieday GitHub OAuth flow.
 *
 * The frontend never talks to GitHub and never holds a secret. It navigates to
 * the backend's existing OAuth *start* route (`/api/auth/github`); the backend
 * owns the client id/secret, the CSRF `state` cookie, the callback route,
 * session creation and the post-login redirect.
 *
 * The backend signals failure by redirecting back to `/login?error=<code>`.
 * Those codes are mapped to short, human messages here — raw provider details,
 * codes and tokens are never surfaced in the UI.
 *
 * @returns {{ state: { status: 'idle'|'redirecting'|'error'|'cancelled'|'unavailable', message?: string }, start: () => void }}
 */

/** The backend's OAuth start route (architecture.md §7). */
const OAUTH_START_URL = '/api/auth/github';

/** Backend error codes → user-facing copy. */
const FRIENDLY_ERRORS = {
  denied: 'You cancelled the GitHub sign-in. Connect whenever you’re ready.',
  state: 'That sign-in link expired. Please start a fresh connection.',
  exchange_failed: 'We couldn’t complete the GitHub connection. Please try again.',
  db_unavailable: 'The sign-in was approved but could not be saved. Please try again.',
};

const CANCELLED = 'cancelled';

export function useGitHubAuth() {
  const [state, setState] = useState({ status: 'idle' });
  const [searchParams, setSearchParams] = useSearchParams();
  // Guards against a second click starting a second OAuth flow while the
  // first navigation is still in flight.
  const starting = useRef(false);
  // The OAuth result is read exactly once (same pattern as the Dashboard's
  // `connected=1` marker).
  const errorHandled = useRef(false);

  // 1. Read the OAuth result the backend left in the URL, then clean the URL
  //    so a refresh does not replay the error.
  useEffect(() => {
    if (errorHandled.current) return;
    const error = searchParams.get('error');
    if (!error) return;
    errorHandled.current = true;

    const next = new URLSearchParams(searchParams);
    next.delete('error');
    next.delete('code');
    next.delete('state');
    setSearchParams(next, { replace: true });

    if (error === 'denied') {
      setState({ status: CANCELLED });
      return;
    }
    setState({ status: 'error', message: FRIENDLY_ERRORS[error] });
  }, [searchParams, setSearchParams]);

  // 2. Returning via the browser Back button restores the page from bfcache:
  //    reset the spinner so the button is usable again.
  useEffect(() => {
    const onPageShow = (event) => {
      if (event.persisted) {
        starting.current = false;
        setState({ status: 'idle' });
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // 3. Ask the backend whether GitHub sign-in is configured. /api/health is a
  //    public, no-network-call endpoint, so a misconfigured deployment shows an
  //    honest notice instead of a button that fails on click.
  useEffect(() => {
    let cancelled = false;
    apiGet('/api/health')
      .then((health) => {
        if (cancelled) return;
        if (health?.github !== 'configured') {
          setState((s) => (s.status === 'idle' ? { status: 'unavailable' } : s));
        }
      })
      .catch(() => {
        // The health probe failing does not mean OAuth is unavailable — the
        // button stays enabled and the real flow decides.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(() => {
    if (starting.current) return;
    starting.current = true;
    setState({ status: 'redirecting' });
    // Let the loading state paint before the navigation begins.
    requestAnimationFrame(() => {
      // Real document navigation (not a router Link) so the browser follows
      // the server's redirect to GitHub. `location.replace` keeps the login
      // page out of history, so Back after login does not return to a login
      // page that immediately bounces forward again.
      window.location.replace(OAUTH_START_URL);
    });
  }, []);

  return { state, start };
}

export default useGitHubAuth;
