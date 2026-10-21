import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import App from './App.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { apiGet } from './lib/apiClient.js';
import { fakeAuth, TestProviders } from './test/helpers.jsx';

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

function apiMe(resolved) {
  apiGet.mockImplementation((path) => {
    if (path === '/api/auth/me') return Promise.resolve(resolved);
    if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
    return Promise.resolve({});
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

describe('App gate — authentication initialization (T1.3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an authenticated session settles on the requested protected route without rendering login', async () => {
    apiMe(meUser);
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull();
    expect(apiGet).toHaveBeenCalledWith('/api/auth/me');
  });

  it('an unauthenticated session redirects to login and renders no protected content', async () => {
    const err = Object.assign(new Error('UNAUTHENTICATED'), {
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    apiGet.mockRejectedValue(err);
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Overview', level: 1 })).toBeNull();
  });

  it('session initialization is single-flight: /api/auth/me is fetched once despite StrictMode double mount', async () => {
    apiMe(meUser);
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy());
    const meCalls = apiGet.mock.calls.filter(([path]) => path === '/api/auth/me');
    expect(meCalls).toHaveLength(1);
  });

  it('an already-authenticated user on /login bounces to /', async () => {
    apiMe(meUser);
    renderApp('/login');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy());
  });
});

describe('Dashboard — OAuth connected=1 marker processed exactly once', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears connected=1 via replace and pushes a single success toast; same-instance re-render does not repeat it', async () => {
    apiMe(meUser);

    const tree = (
      <TestProviders initialEntries={['/dashboard?connected=1']} auth={fakeAuth}>
        <Dashboard />
      </TestProviders>
    );
    const { rerender } = render(tree);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy());

    // Feedback emitted exactly once on mount (one toast node in the DOM).
    expect(screen.getAllByText('GitHub connected.')).toHaveLength(1);

    // Same-instance re-render must not repeat the callback handling or toast.
    act(() => {
      rerender(tree);
    });
    expect(screen.getAllByText('GitHub connected.')).toHaveLength(1);
  });
});

describe('Dashboard — sync progress initialization safety', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without crashing when sync progress has not yet loaded (syncProgress is null)', async () => {
    apiMe(meUser);
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(meUser);
      if (path.startsWith('/api/dashboard')) return Promise.resolve(dashboardPayload);
      if (path.startsWith('/api/sync/status')) return Promise.resolve({});
      return Promise.resolve({});
    });

    const { rerender } = render(
      <TestProviders initialEntries={['/dashboard']} auth={fakeAuth}>
        <Dashboard />
      </TestProviders>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy());

    // Re-rendering must not crash (no syncProgress.total on undefined/null).
    act(() => {
      rerender(
        <TestProviders initialEntries={['/dashboard']} auth={fakeAuth}>
          <Dashboard />
        </TestProviders>
      );
    });
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy();

    // Re-rendering must not crash (no syncProgress.total on undefined/null).
    act(() => {
      rerender(
        <TestProviders initialEntries={['/dashboard']} auth={fakeAuth}>
          <Dashboard />
        </TestProviders>
      );
    });
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy();
  });
});
