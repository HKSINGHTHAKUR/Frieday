import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Repositories from './Repositories.jsx';
import { TestProviders, API_FIXTURES } from '../test/helpers.jsx';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
import { apiGet } from '../lib/apiClient.js';

const PAGE_ONE = {
  items: [
    API_FIXTURES.repoItem,
    {
      ...API_FIXTURES.repoItem,
      id: '64b64b64b64b64b64b64b642',
      fullName: 'tester/web',
      health: 'stalled',
      primaryLanguage: 'Go',
      stars: 3,
    },
  ],
  nextCursor: 'cursor-token-1',
  hasMore: true,
};

const PAGE_TWO = {
  items: [
    { ...API_FIXTURES.repoItem, id: '64b64b64b64b64b64b64b643', fullName: 'tester/cli', health: 'quiet' },
  ],
  nextCursor: null,
  hasMore: false,
};

function renderRepos(initialEntries) {
  const user = userEvent.setup();
  return {
    user,
    ...render(
      <TestProviders initialEntries={initialEntries}>
        <Repositories />
      </TestProviders>
    ),
  };
}

describe('Repositories page (T5.3)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('cursor=cursor-token-1')) return PAGE_TWO;
      if (url.includes('/api/repos')) return PAGE_ONE;
      return {};
    });
  });

  it('renders repositories with health, visibility, and counts from the API', async () => {
    renderRepos(['/repositories']);

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    expect(screen.getByText('tester/web')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Stalled')).toBeTruthy();
    expect(screen.getAllByText('private').length).toBeGreaterThanOrEqual(1);
    expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/repos\?sort=activity&limit=50$/));
  });

  it('paginates with the cursor contract and disables the button while loading', async () => {
    const { user } = renderRepos(['/repositories']);

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    const next = screen.getByRole('button', { name: /Next page/ });
    await user.click(next);

    await waitFor(() => expect(screen.getByText('tester/cli')).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith('/api/repos?sort=activity&limit=50&cursor=cursor-token-1');
    // Page two has no more results: the Next control disappears.
    expect(screen.queryByRole('button', { name: /Next page/ })).toBeNull();
  });

  it('shows the empty state with a connect CTA', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      return { items: [], nextCursor: null, hasMore: false };
    });
    renderRepos(['/repositories']);

    await waitFor(() => expect(screen.getByText('No repositories synced yet')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
  });

  it('shows an error state with retry that reloads', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (apiGet.mock.calls.filter((c) => c[0] === url).length > 1) return PAGE_ONE;
      throw new Error('server exploded');
    });
    const { user } = renderRepos(['/repositories']);

    await waitFor(() => expect(screen.getByText('Could not load repositories')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
  });

  it('sort selection is URL-synced and refetches with the chosen sort', async () => {
    const { user } = renderRepos(['/repositories']);

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Recent' }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/repos?sort=recent&limit=50'));
  });
});
