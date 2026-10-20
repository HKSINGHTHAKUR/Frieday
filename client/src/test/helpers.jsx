import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../store/AuthStore.jsx';
import { SyncProvider } from '../store/SyncStore.jsx';
import { ToastProvider } from '../store/ToastStore.jsx';

/** Shared fake auth value for page tests (settings, repos, insights). */
export const fakeAuth = {
  status: 'authenticated',
  user: {
    githubId: 1,
    login: 'tester',
    avatarUrl: '',
    profileUrl: 'https://github.com/tester',
    scopes: ['repo', 'read:user'],
  },
  connected: true,
  lastSyncedAt: '2026-10-01T00:00:00Z',
  logout: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue({ revoked: true, disconnected: true }),
  deleteData: vi.fn().mockResolvedValue(undefined),
  loadMe: vi.fn().mockResolvedValue(undefined),
  refreshSession: vi.fn().mockResolvedValue(true),
};

/**
 * Renders a page inside the providers the app shell supplies:
 * MemoryRouter + Auth + Toast + Sync contexts.
 */
export function TestProviders({ children, initialEntries = ['/'], auth = fakeAuth }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <SyncProvider>{children}</SyncProvider>
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

/** Standard mock payloads matching the documented T5.1 API shapes. */
export const API_FIXTURES = {
  syncIdle: {
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
  },
  repoItem: {
    id: '64b64b64b64b64b64b64b64b',
    githubId: 100,
    fullName: 'tester/app',
    owner: 'tester',
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
  insight: {
    id: '64b64b64b64b64b64b64b64b',
    templateId: 'activity-momentum',
    title: 'Activity momentum',
    text: 'Commits are up 12% versus the prior period.',
    metrics: { commits: 120, changePercent: 12.5 },
    evidence: {
      repoIds: ['64b64b64b64b64b64b64b64b'],
      commitShas: ['abcdef1234567890abcdef1234567890abcd1234'],
      prNumbers: [42],
      bucketStarts: ['2026-09-01T00:00:00Z'],
    },
    confidence: 'High',
    generatedAt: '2026-10-04T12:00:00Z',
  },
};
