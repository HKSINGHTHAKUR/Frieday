/**
 * Dashboard integration tests (Phase 10.1) — the Commit themes card inside
 * the real dashboard, plus the focus-area empty state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Dashboard from './Dashboard.jsx';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({
    user: { login: 'tester', avatarUrl: '', profileUrl: '', scopes: ['repo'] },
    status: 'authenticated',
    connected: true,
    lastSyncedAt: '2026-10-01T00:00:00Z',
    logout: vi.fn(),
    disconnect: vi.fn(),
    deleteData: vi.fn(),
    loadMe: vi.fn(),
    refreshSession: vi.fn(),
  }),
}));
import { apiGet } from '../lib/apiClient.js';
import { SyncProvider } from '../store/SyncStore.jsx';
import { ToastProvider } from '../store/ToastStore.jsx';

const BASE_PAYLOAD = {
  kpis: { repoCount: 4, totalCommits: 120, totalPRs: 18, totalIssues: 7 },
  deltas: { deltas: {} },
  buckets: [{ bucketStart: '2026-09-01T00:00:00Z', commits: 3, prsOpened: 1, prsMerged: 0 }],
  languages: {
    weightedBytes: { JavaScript: 900, TypeScript: 600 },
    commitShare: { JavaScript: 0.6, TypeScript: 0.4 },
  },
  focus: [{ tag: 'API work', confidence: 'High', evidence: { repoNames: ['me/app'] } }],
  consistency: { activeDays: 12, currentStreak: 3, longestStreak: 9, gaps: [] },
  repoHealth: [],
  insights: [],
};

const THEMES_PAYLOAD = {
  version: 1,
  rulesVersion: 1,
  totalCommits: 120,
  themedCommits: 84,
  unclassified: 20,
  noMessage: 10,
  noise: 6,
  items: [
    {
      theme: 'Bug fix',
      confidence: 'High',
      commitCount: 40,
      share: 0.476,
      evidence: { repoNames: ['me/app'], commitShas: ['a1'], sampleMessages: ['fix: crash'] },
    },
  ],
};

function renderDashboard(payload) {
  apiGet.mockImplementation(async (url) => {
    if (url.startsWith('/api/dashboard')) return payload;
    if (url.includes('/api/sync/status')) {
      return { status: 'idle', jobId: null, kind: null, phase: null, done: 0, total: 0 };
    }
    return {};
  });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <main id="main-content">
        <ToastProvider>
          <SyncProvider>
            <Routes>
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </SyncProvider>
        </ToastProvider>
      </main>
    </MemoryRouter>
  );
}

beforeEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe('Dashboard — Commit themes card (Phase 10.1)', () => {
  it('renders the Commit themes card with the denominator', async () => {
    renderDashboard({ ...BASE_PAYLOAD, themes: THEMES_PAYLOAD });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Commit themes' })).toBeTruthy());
    expect(screen.getByText('of 84 themed commits')).toBeTruthy();
    expect(screen.getByText('Bug fix')).toBeTruthy();
  });

  it('renders the honest empty state when no commits are themed', async () => {
    renderDashboard({
      ...BASE_PAYLOAD,
      themes: { ...THEMES_PAYLOAD, themedCommits: 0, items: [] },
    });
    await waitFor(() => expect(screen.getByText('No commit themes detected')).toBeTruthy());
    expect(screen.queryByText('of 84 themed commits')).toBeNull();
  });

  it('renders the empty state when the payload has no themes block', async () => {
    renderDashboard(BASE_PAYLOAD);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Commit themes' })).toBeTruthy());
    expect(screen.getByText('No commit themes detected')).toBeTruthy();
  });

  it('keeps the Focus areas card and its content separate from the themes card', async () => {
    renderDashboard({ ...BASE_PAYLOAD, themes: THEMES_PAYLOAD });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Commit themes' })).toBeTruthy());

    // Both cards render their own content — the focus list is not replaced
    // by an empty state, and the themes card is present alongside it.
    expect(screen.getByText('API work')).toBeTruthy();
    expect(screen.queryByText('No focus areas detected')).toBeNull();
    expect(screen.getByText('Bug fix')).toBeTruthy();
  });

  it('shows the Focus areas empty state only when there is genuinely no focus data', async () => {
    renderDashboard({ ...BASE_PAYLOAD, focus: [], themes: THEMES_PAYLOAD });
    await waitFor(() => expect(screen.getByText('No focus areas detected')).toBeTruthy());
    // The themes card is unaffected by the focus empty state.
    expect(screen.getByText('Bug fix')).toBeTruthy();
  });
});
