import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import RepoDetail from './RepoDetail.jsx';
import { TestProviders, API_FIXTURES } from '../test/helpers.jsx';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
import { apiGet } from '../lib/apiClient.js';

const REPO_ID = '64b64b64b64b64b64b64b64b';

const DETAIL = {
  ...API_FIXTURES.repoItem,
  htmlUrl: 'https://github.com/tester/app',
  recentActivity: {
    commits: [
      {
        sha: 'abc123def456',
        messageFull: 'feat: add dashboard',
        messageHeadline: 'feat: add dashboard',
        authoredAt: '2026-10-04T09:00:00Z',
      },
    ],
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
        title: 'Fix legend overlap',
        state: 'open',
        createdAt: '2026-10-02T09:00:00Z',
        updatedAt: '2026-10-02T15:00:00Z',
      },
    ],
  },
  miniTimeline: [
    { bucketStart: '2026-09-01T00:00:00Z', commits: 1, prsOpened: 0, prsMerged: 0, issuesTouched: 0 },
    { bucketStart: '2026-09-02T00:00:00Z', commits: 3, prsOpened: 1, prsMerged: 0, issuesTouched: 0 },
  ],
};

function renderDetail(initialEntries) {
  const user = userEvent.setup();
  return {
    user,
    ...render(
      <TestProviders initialEntries={initialEntries}>
        <Routes>
          <Route path="/repositories/:id" element={<RepoDetail />} />
        </Routes>
      </TestProviders>
    ),
  };
}

describe('RepoDetail page (T5.3)', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('renders identity, health, activity data, and recent items from the API', async () => {
    apiGet.mockResolvedValue(DETAIL);
    renderDetail([`/repositories/${REPO_ID}`]);

    await waitFor(() => expect(screen.getAllByText('tester/app').length).toBeGreaterThan(0));
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('#42 Add charts')).toBeTruthy();
    expect(screen.getByText('#7 Fix legend overlap')).toBeTruthy();
    expect(screen.getByText('feat: add dashboard')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Activity chart/ })).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith(`/api/repos/${REPO_ID}?range=90d`);
  });

  it('renders skeletons while loading, then the populated view', async () => {
    let resolveDetail;
    apiGet.mockImplementation((url) => {
      if (url.includes('/api/repos/')) {
        return new Promise((resolve) => {
          resolveDetail = () => resolve(DETAIL);
        });
      }
      return Promise.resolve(API_FIXTURES.syncIdle);
    });
    renderDetail([`/repositories/${REPO_ID}`]);

    await waitFor(() => expect(document.querySelectorAll('.skeleton-pulse').length).toBeGreaterThan(0));

    await act(async () => {
      resolveDetail();
    });

    await waitFor(() => expect(screen.getAllByText('tester/app').length).toBeGreaterThan(0));
  });

  it('shows an error state with retry for server failures', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/repos/')) throw new Error('boom');
      return API_FIXTURES.syncIdle;
    });
    const { user } = renderDetail([`/repositories/${REPO_ID}`]);

    await waitFor(() => expect(screen.getByText('Could not load this repository')).toBeTruthy());
    apiGet.mockImplementation(async (url) => (url.includes('/api/repos/') ? DETAIL : API_FIXTURES.syncIdle));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getAllByText('tester/app').length).toBeGreaterThan(0));
  });

  it('renders the safe inaccessible state on 404 without leaking data', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/repos/')) {
        const err = new Error('Repository not found.');
        err.status = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      return API_FIXTURES.syncIdle;
    });
    renderDetail([`/repositories/64b64b64b64b64b64b64b640`]);

    await waitFor(() => expect(screen.getByText('This repository is no longer accessible')).toBeTruthy());
    expect(screen.getByText(/It was last synced/)).toBeTruthy();
    expect(screen.queryByText('#42 Add charts')).toBeNull();
  });

  it('range selection is URL-synced', async () => {
    apiGet.mockResolvedValue(DETAIL);
    const { user } = renderDetail([`/repositories/${REPO_ID}?range=30d`]);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/api/repos/${REPO_ID}?range=30d`));
    await user.click(screen.getByRole('button', { name: '12m' }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/api/repos/${REPO_ID}?range=12m`));
  });

  it.each([
    ['30d', 'Daily commits, last 30d.'],
    ['90d', 'Weekly commits, last 90d.'],
    ['12m', 'Weekly commits, last 12m.'],
  ])(
    'mini-timeline caption reflects range %s granularity (no fabricated buckets)',
    async (range, expectedCaption) => {
      apiGet.mockResolvedValue(DETAIL);
      renderDetail([`/repositories/${REPO_ID}?range=${range}`]);

      await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/api/repos/${REPO_ID}?range=${range}`));
      expect(screen.getByText(expectedCaption)).toBeTruthy();
      // The activity chart is rendered only from API buckets, never synthesized.
      if (DETAIL.miniTimeline.length) {
        expect(screen.getByRole('img', { name: /Activity chart/ })).toBeTruthy();
      }
    }
  );

  it('renders an empty state instead of a fabricated flatline when miniTimeline is empty', async () => {
    apiGet.mockResolvedValue({ ...DETAIL, miniTimeline: [] });
    renderDetail([`/repositories/${REPO_ID}?range=90d`]);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/api/repos/${REPO_ID}?range=90d`));
    // ActivityChart shows its empty state for empty data — no chart, no fake bars.
    expect(screen.queryByRole('img', { name: /Activity chart/ })).toBeNull();
    expect(screen.getByText('No activity in this range')).toBeTruthy();
  });
});
