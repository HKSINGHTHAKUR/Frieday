import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, Routes, Route } from 'react-router-dom';
import Timeline from './Timeline.jsx';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
}));
vi.mock('../components/charts/ActivityChart.jsx', () => ({
  default: ({ buckets }) => (
    <div data-testid="chart-stub" data-buckets={buckets.length}>
      chart
    </div>
  ),
}));
import { apiGet } from '../lib/apiClient.js';

const SAMPLE_BUCKETS = [
  { bucketStart: '2026-09-01T00:00:00Z', commits: 2, prsOpened: 1, prsMerged: 0, issuesTouched: 0 },
  { bucketStart: '2026-09-02T00:00:00Z', commits: 0, prsOpened: 0, prsMerged: 0, issuesTouched: 2 },
];

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="router-search">{location.search}</span>;
}

function renderTimeline(initialSearch) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/timeline${initialSearch}`]}>
      <Routes>
        <Route
          path="/timeline"
          element={
            <>
              <LocationProbe />
              <Timeline />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  return { user };
}

describe('Timeline URL synchronization (T5.2)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url) => {
      if (url.startsWith('/api/timeline')) {
        return { buckets: SAMPLE_BUCKETS };
      }
      if (url.includes('/api/repos')) {
        return {
          items: [
            { id: 'repo-1', fullName: 'me/app', visibility: 'private' },
            { id: 'repo-2', fullName: 'me/web', visibility: 'public' },
          ],
        };
      }
      return {};
    });
  });

  it('reads range, repoId, and granularity from the URL into the API request', async () => {
    renderTimeline('?range=90d&repoId=abc123&granularity=week');

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/api/timeline?range=90d&repoId=abc123&granularity=week')
    );
  });

  it('applies defaults when URL params are missing', async () => {
    renderTimeline('');

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/timeline?range=30d&granularity=day'));
  });

  it('defaults granularity to week for 90d and 12m (prd.md §9 F4 semantics)', async () => {
    renderTimeline('?range=90d');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/timeline?range=90d&granularity=week'));

    apiGet.mockClear();
    renderTimeline('?range=12m');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/timeline?range=12m&granularity=week'));
  });

  it('loads the repository filter list within the API limit (50)', async () => {
    // Regression: the repo-filter load used limit=100, exceeding the backend
    // schema max of 50 → 400 → silently empty dropdown (T9 fix #7).
    const { user } = renderTimeline('?range=30d');

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/repos?sort=activity&limit=50'));

    await user.click(screen.getByRole('button', { name: 'Filter repositories' }));
    expect(await screen.findByRole('option', { name: /me\/app/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /me\/web/ })).toBeTruthy();
  });

  it('changing the range updates the URL', async () => {
    const { user } = renderTimeline('?range=30d');

    await waitFor(() => expect(screen.getByRole('group', { name: 'Time range' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '12m' }));

    await waitFor(() => expect(screen.getByTestId('router-search').textContent).toContain('range=12m'));
  });

  it('changing the repository updates the URL repoId', async () => {
    const { user } = renderTimeline('?range=30d');

    await user.click(screen.getByRole('button', { name: 'Filter repositories' }));
    const option = await screen.findByRole('option', { name: /me\/web/ });
    await user.click(option);

    await waitFor(() => expect(screen.getByTestId('router-search').textContent).toContain('repoId=repo-2'));
  });

  it('changing the granularity updates the URL', async () => {
    const { user } = renderTimeline('?range=30d');

    await waitFor(() => expect(screen.getByRole('group', { name: 'Granularity' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Week' }));

    await waitFor(() =>
      expect(screen.getByTestId('router-search').textContent).toContain('granularity=week')
    );
  });

  it('toggling chart/table does not corrupt the filter URL state', async () => {
    const { user } = renderTimeline('?range=90d&repoId=abc123&granularity=week');

    await waitFor(() => expect(screen.getByTestId('chart-stub')).toBeTruthy());
    expect(screen.getByTestId('router-search').textContent).toBe('?range=90d&repoId=abc123&granularity=week');

    await user.click(screen.getByRole('button', { name: 'Table' }));

    expect(screen.getByTestId('router-search').textContent).toBe('?range=90d&repoId=abc123&granularity=week');
    expect(screen.getByRole('table')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Chart' }));
    expect(screen.getByTestId('router-search').textContent).toBe('?range=90d&repoId=abc123&granularity=week');
    expect(screen.getByTestId('chart-stub')).toBeTruthy();
  });

  it('renders the table equivalent from the same bucket payload as the chart', async () => {
    renderTimeline('?range=30d');

    await waitFor(() => expect(screen.getByTestId('chart-stub')).toBeTruthy());
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(0);
    // Chart stub receives the same buckets the table renders
    expect(Number(screen.getByTestId('chart-stub').dataset.buckets)).toBe(SAMPLE_BUCKETS.length);
  });
});
