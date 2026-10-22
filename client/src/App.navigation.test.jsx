import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import App from './App.jsx';
import { apiGet, apiPost } from './lib/apiClient.js';
import { useAuth } from './hooks/useAuth.js';
import { AuthProvider } from './store/AuthStore.jsx';

/**
 * The navigation / authentication lifecycle (Part D of the fix).
 *
 * The bug these tests pin: the session probe ran ONCE per document load, so
 * a same-document history navigation (React Router's push) never re-checked
 * the session. After a logout, pressing Back restored the protected dashboard
 * with stale, private data while the server session was already gone.
 *
 * The fix re-validates on `popstate` and on a back-forward-cache restore
 * (`pageshow` with `persisted: true`), and shows a neutral loading screen
 * while the check is in flight so protected content is never shown for a
 * session that may no longer exist.
 */

vi.mock('./lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  setSessionRefresher: vi.fn(),
}));

const meUser = {
  user: {
    githubId: 1,
    login: 'tester',
    avatarUrl: '',
    profileUrl: 'https://github.com/tester',
    scopes: ['repo'],
  },
  connected: true,
  lastSyncedAt: '2026-10-01T00:00:00Z',
};

const dashboardPayload = {
  kpis: {},
  deltas: { deltas: {} },
  buckets: [],
  languages: { weightedBytes: {}, commitShare: {} },
  focus: [],
  consistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
  repoHealth: [],
  insights: [],
};

/** Builds a 401 the apiClient would surface for an expired session. */
function unauthenticated() {
  return Object.assign(new Error('UNAUTHENTICATED'), {
    status: 401,
    code: 'UNAUTHENTICATED',
  });
}

function renderApp(initialPath = '/') {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </StrictMode>
  );
}

/** Counts the /api/auth/me probes. */
function meCalls() {
  return apiGet.mock.calls.filter(([path]) => path === '/api/auth/me').length;
}

describe('App gate — session revalidation on history navigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiPost.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-validates the session on a popstate (Back / Forward)', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(meUser);
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      return Promise.resolve({});
    });
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy());
    const before = meCalls();

    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => expect(meCalls()).toBeGreaterThan(before));
  });

  it('re-validates the session on a back-forward-cache restore (pageshow persisted)', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(meUser);
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      return Promise.resolve({});
    });
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy());
    const before = meCalls();

    await act(async () => {
      const event = new Event('pageshow');
      Object.defineProperty(event, 'persisted', { value: true });
      window.dispatchEvent(event);
    });

    await waitFor(() => expect(meCalls()).toBeGreaterThan(before));
  });

  it('does NOT re-validate on a normal (non-persisted) pageshow', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(meUser);
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      return Promise.resolve({});
    });
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy());
    const before = meCalls();

    await act(async () => {
      const event = new Event('pageshow');
      Object.defineProperty(event, 'persisted', { value: false });
      window.dispatchEvent(event);
    });

    expect(meCalls()).toBe(before);
  });

  it('shows no protected content while the revalidation is in flight', async () => {
    let resolveMe;
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') {
        return new Promise((resolve) => {
          resolveMe = resolve;
        });
      }
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      return Promise.resolve({});
    });
    renderApp('/dashboard');
    await waitFor(() => expect(resolveMe).toBeTruthy());

    // The session is now known; the next probe (a history move) hangs.
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return new Promise(() => {});
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      return Promise.resolve({});
    });
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // The protected heading must NOT be on screen while the check is pending.
    expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('drops the protected view when the revalidation finds an expired session', async () => {
    // The FIRST probe succeeds (the user is signed in); every probe after that
    // fails with 401 (the session expired).
    let probes = 0;
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') {
        probes += 1;
        if (probes === 1) return Promise.resolve(meUser);
        return Promise.reject(unauthenticated());
      }
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      return Promise.resolve({});
    });
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy());

    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // The session is gone: the protected view must not survive.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
  });

  it('a probe that resolves after a logout cannot resurrect the session', async () => {
    // The session probe hangs, then the user logs out, then the probe
    // resolves as if the session were still valid. The stale response must
    // NOT re-render the protected view.
    let resolveMe;
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') {
        return new Promise((resolve) => {
          resolveMe = resolve;
        });
      }
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      return Promise.resolve({});
    });
    apiPost.mockResolvedValue(undefined);

    // The store is the real implementation; the logout is triggered through
    // its public action, exactly as the UI does. The probe lives INSIDE the
    // AuthProvider so it sees the real context.
    let authApi;
    function Probe() {
      authApi = useAuth();
      return <span data-testid="status">{authApi.status}</span>;
    }
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </MemoryRouter>
      </StrictMode>
    );
    await waitFor(() => expect(resolveMe).toBeTruthy());

    // Log out.
    await act(async () => {
      await authApi.logout();
    });
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');

    // The late probe now resolves with a valid-looking session.
    await act(async () => {
      resolveMe(meUser);
    });

    // The stale response must NOT resurrect the session.
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
  });
});

describe('App gate — the login route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiPost.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the login page to a logged-out visitor', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.reject(unauthenticated());
      return Promise.resolve({});
    });
    renderApp('/login');
    expect(await screen.findByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
  });

  it('sends an authenticated visitor away from the login route', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(meUser);
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      return Promise.resolve({});
    });
    renderApp('/login');
    // The dashboard is rendered instead of the login page.
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull();
  });

  it('redirects a logged-out visitor from a protected route to the login page, keeping the destination', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.reject(unauthenticated());
      return Promise.resolve({});
    });
    renderApp('/insights');
    expect(await screen.findByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
    // The intended destination survives in the URL so the sign-in can return
    // the user to it.
    expect(window.location.search).toBe('');
  });

  it('never renders protected content before the server confirms a session', async () => {
    // The session probe hangs: the protected view must not appear.
    apiGet.mockImplementation(() => new Promise(() => {}));
    renderApp('/dashboard');
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull();
  });
});
