import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Dashboard from './Dashboard.jsx';
import Timeline from './Timeline.jsx';
import Repositories from './Repositories.jsx';
import RepoDetail from './RepoDetail.jsx';
import Insights from './Insights.jsx';
import Settings from './Settings.jsx';
import 'axe-core';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({
    user: { login: 'tester', avatarUrl: '', profileUrl: 'https://github.com/tester', scopes: ['repo'] },
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

const DASHBOARD_PAYLOAD = {
  kpis: { repoCount: 4, totalCommits: 120, totalPRs: 18, totalIssues: 7 },
  deltas: { deltas: { repoCount: 0, commits: 12.5, prsOpened: -8.3, activeDays: 4.2 } },
  buckets: [
    { bucketStart: '2026-09-01T00:00:00Z', commits: 3, prsOpened: 1, prsMerged: 0 },
    { bucketStart: '2026-09-08T00:00:00Z', commits: 5, prsOpened: 2, prsMerged: 1 },
  ],
  languages: {
    weightedBytes: { JavaScript: 900, TypeScript: 600 },
    commitShare: { JavaScript: 0.6, TypeScript: 0.4 },
  },
  focus: [{ tag: 'API work', confidence: 'High', evidence: { repoNames: ['me/app'] } }],
  themes: {
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
        evidence: {
          repoNames: ['me/app'],
          commitShas: ['abc123def456'],
          sampleMessages: ['fix: null deref in parser'],
        },
      },
    ],
  },
  consistency: {
    activeDays: 12,
    currentStreak: 3,
    longestStreak: 9,
    gaps: [{ start: '2026-09-10', end: '2026-09-13', length: 4, label: '4-day gap' }],
  },
  repoHealth: [
    {
      repoId: 'repo-1',
      repoName: 'me/app',
      health: 'active',
      openPRs: 2,
      openIssues: 1,
      lastActivityAt: '2026-10-04T12:00:00Z',
    },
  ],
  insights: [
    {
      templateId: 'activity-momentum',
      title: 'Activity momentum',
      text: 'Commits up 12% versus prior period.',
      confidence: 'High',
      metrics: { commits: 120 },
    },
  ],
};

const TIMELINE_PAYLOAD = {
  buckets: [
    { bucketStart: '2026-09-01T00:00:00Z', commits: 3, prsOpened: 1, prsMerged: 0, issuesTouched: 0 },
    { bucketStart: '2026-09-08T00:00:00Z', commits: 5, prsOpened: 2, prsMerged: 1, issuesTouched: 2 },
  ],
};

const REPO_THEME_PAYLOAD = {
  version: 1,
  rulesVersion: 1,
  totalCommits: 34,
  themedCommits: 28,
  unclassified: 4,
  noMessage: 0,
  noise: 2,
  items: [
    {
      theme: 'Bug fix',
      confidence: 'High',
      commitCount: 20,
      share: 0.714,
      evidence: {
        repoNames: ['me/app'],
        commitShas: ['abc123def456'],
        sampleMessages: ['fix: null deref in parser'],
      },
    },
    {
      theme: 'Feature',
      confidence: 'Medium',
      commitCount: 8,
      share: 0.286,
      evidence: {
        repoNames: ['me/app'],
        commitShas: ['def456abc123'],
        sampleMessages: ['feat: add dashboard'],
      },
    },
  ],
  topTheme: { theme: 'Bug fix', commitCount: 20, share: 0.714, confidence: 'High' },
};

const REPO_LIST_PAYLOAD = {
  items: [
    {
      id: '64b64b64b64b64b64b64b64b',
      fullName: 'me/app',
      owner: 'me',
      name: 'app',
      visibility: 'private',
      primaryLanguage: 'TypeScript',
      stars: 12,
      fork: false,
      pushedAt: '2026-10-04T10:00:00Z',
      updatedAt: '2026-10-04T10:00:00Z',
      description: 'Main application',
      health: 'active',
      daysSinceActivity: 1,
      lastActivityAt: '2026-10-04T12:00:00Z',
      openPRs: 2,
      openIssues: 1,
    },
    {
      id: '64b64b64b64b64b64b64b64c',
      fullName: 'me/web',
      owner: 'me',
      name: 'web',
      visibility: 'public',
      primaryLanguage: 'JavaScript',
      stars: 4,
      fork: false,
      pushedAt: '2026-10-03T10:00:00Z',
      updatedAt: '2026-10-03T10:00:00Z',
      description: 'Web client',
      health: 'steady',
      daysSinceActivity: 12,
      lastActivityAt: '2026-10-03T12:00:00Z',
      openPRs: 1,
      openIssues: 0,
    },
  ],
  nextCursor: null,
  hasMore: false,
  // Phase 10.2: the theme map must be covered by the accessibility fixture —
  // the per-repo drill-down panels are landmarks, and two open panels must
  // not share an accessible name.
  repoThemes: {
    '64b64b64b64b64b64b64b64b': REPO_THEME_PAYLOAD,
    '64b64b64b64b64b64b64b64c': REPO_THEME_PAYLOAD,
  },
};

const REPO_DETAIL_PAYLOAD = {
  ...REPO_LIST_PAYLOAD.items[0],
  htmlUrl: 'https://github.com/me/app',
  recentActivity: {
    commits: [{ sha: 'abc123def456', message: 'feat: dashboard', authoredAt: '2026-10-04T09:00:00Z' }],
    pullRequests: [
      {
        number: 42,
        title: 'Add charts',
        state: 'merged',
        createdAt: '2026-10-03T09:00:00Z',
        mergedAt: '2026-10-03T11:00:00Z',
      },
    ],
    issues: [
      {
        number: 7,
        title: 'Fix legend',
        state: 'open',
        createdAt: '2026-10-02T09:00:00Z',
        updatedAt: '2026-10-02T15:00:00Z',
      },
    ],
  },
  miniTimeline: [
    { bucketStart: '2026-09-01T00:00:00Z', commits: 1, prsOpened: 0, prsMerged: 0, issuesTouched: 0 },
  ],
};

const INSIGHTS_PAYLOAD = {
  insights: [
    {
      templateId: 'activity-momentum',
      title: 'Activity momentum',
      text: 'Commits are up versus the prior period.',
      metrics: { commits: 120 },
      evidence: {
        repoIds: ['64b64b64b64b64b64b64b64b'],
        commitShas: ['abcdef1234567890'],
        prNumbers: [42],
        bucketStarts: ['2026-09-01T00:00:00Z'],
      },
      confidence: 'High',
      generatedAt: '2026-10-04T12:00:00Z',
    },
  ],
};

const SYNC_IDLE = {
  status: 'idle',
  jobId: null,
  kind: null,
  phase: null,
  done: 0,
  total: 0,
  perResource: {},
  counts: {},
  resources: {},
  history: [],
  error: null,
  resumeAt: null,
  startedAt: null,
  finishedAt: null,
};

/**
 * The real app renders pages inside PageShell's <main id="main-content">
 * (design_system.md §8) plus the sync/toast providers. The axe test
 * reproduces that exact landmark + provider context.
 */
function renderInShell(ui, initialEntries) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <main id="main-content">
        <ToastProvider>
          <SyncProvider>
            <Routes>{ui}</Routes>
          </SyncProvider>
        </ToastProvider>
      </main>
    </MemoryRouter>
  );
}

async function assertAxeClean() {
  const results = await window.axe.run(document, { resultTypes: ['violations'] });
  const summarized = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }));
  if (summarized.length) {
    throw new Error(`axe violations: ${JSON.stringify(summarized, null, 2)}`);
  }
  expect(summarized).toEqual([]);
}

describe('T5.2 + T5.3 accessibility (axe, design_system.md §28)', () => {
  beforeAll(() => {
    if (!window.axe) throw new Error('axe-core failed to attach to window in jsdom');
  });

  beforeEach(() => {
    cleanup();
    apiGet.mockReset();
    apiGet.mockImplementation(async (url) => {
      if (url.startsWith('/api/dashboard')) return DASHBOARD_PAYLOAD;
      if (url.startsWith('/api/timeline')) return TIMELINE_PAYLOAD;
      if (url.includes('/api/sync/status')) return SYNC_IDLE;
      if (url.match(/\/api\/repos\/[0-9a-f]{24}/)) return REPO_DETAIL_PAYLOAD;
      if (url.startsWith('/api/repos')) return REPO_LIST_PAYLOAD;
      if (url.startsWith('/api/insights')) return INSIGHTS_PAYLOAD;
      return {};
    });
  });

  it('Dashboard renders with no axe violations', async () => {
    renderInShell(<Route path="*" element={<Dashboard />} />, ['/']);
    await waitFor(() => expect(screen.getByText('Overview')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Activity momentum')).toBeTruthy());
    await assertAxeClean();
  });

  it('Timeline renders with no axe violations (chart view)', async () => {
    renderInShell(<Route path="*" element={<Timeline />} />, ['/timeline']);
    await waitFor(() => expect(screen.getByText('Timeline')).toBeTruthy());
    await waitFor(() => expect(screen.getAllByRole('table').length).toBeGreaterThan(0));
    await assertAxeClean();
  });

  it('Timeline renders with no axe violations (table view)', async () => {
    const { default: userEventFn } = await import('@testing-library/user-event');
    const user = userEventFn.setup();
    renderInShell(<Route path="*" element={<Timeline />} />, ['/timeline']);
    await waitFor(() => expect(screen.getAllByRole('table').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'Table' }));
    await waitFor(() => expect(screen.getAllByRole('table').length).toBeGreaterThan(0));
    await assertAxeClean();
  });

  it('Repositories renders with no axe violations', async () => {
    renderInShell(<Route path="*" element={<Repositories />} />, ['/repositories']);
    await waitFor(() => expect(screen.getByText('me/app')).toBeTruthy());
    await assertAxeClean();
  });

  it('Repositories with TWO open theme drill-downs has no axe violations', async () => {
    // The per-repo theme panel is a landmark region. Two open panels must
    // have UNIQUE accessible names, otherwise axe reports `landmark-unique`.
    const { default: userEventFn } = await import('@testing-library/user-event');
    const user = userEventFn.setup();
    renderInShell(<Route path="*" element={<Repositories />} />, ['/repositories']);
    await waitFor(() => expect(screen.getByText('me/app')).toBeTruthy());

    const toggles = screen.getAllByRole('button', { name: /View themes/ });
    expect(toggles.length).toBe(2);
    await user.click(toggles[0]);
    await user.click(toggles[1]);

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: /^Commit themes for / }).length).toBe(2);
    });
    await assertAxeClean();
  });

  it('RepoDetail renders with no axe violations', async () => {
    renderInShell(<Route path="/repositories/:id" element={<RepoDetail />} />, [
      '/repositories/64b64b64b64b64b64b64b64b',
    ]);
    await waitFor(() => expect(screen.getAllByText('me/app').length).toBeGreaterThan(0));
    await assertAxeClean();
  });

  it('Insights renders with no axe violations', async () => {
    renderInShell(<Route path="*" element={<Insights />} />, ['/insights']);
    await waitFor(() => expect(screen.getByText('Activity momentum')).toBeTruthy());
    await assertAxeClean();
  });

  it('Settings renders with no axe violations', async () => {
    renderInShell(<Route path="*" element={<Settings />} />, ['/settings']);
    await waitFor(() => expect(screen.getByText('tester')).toBeTruthy());
    await assertAxeClean();
  });
});
