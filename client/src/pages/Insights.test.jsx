import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Insights from './Insights.jsx';
import { TestProviders, API_FIXTURES } from '../test/helpers.jsx';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
import { apiGet, apiPost } from '../lib/apiClient.js';

const INSIGHT_ID = '64b64b64b64b64b64b64b64b';

function renderInsights(initialEntries) {
  const user = userEvent.setup();
  return {
    user,
    ...render(
      <TestProviders initialEntries={initialEntries}>
        <Insights />
      </TestProviders>
    ),
  };
}

describe('Insights page (T5.3)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/insights')) return { insights: [API_FIXTURES.insight] };
      return {};
    });
  });

  it('renders stored insights with provenance and no AI UI', async () => {
    renderInsights(['/insights']);

    await waitFor(() => expect(screen.getByText('Activity momentum')).toBeTruthy());
    expect(screen.getByText('Commits are up 12% versus the prior period.')).toBeTruthy();
    expect(screen.getByText('High confidence')).toBeTruthy();
    expect(screen.getByText('Product insight')).toBeTruthy();
    expect(screen.getByText('commits:')).toBeTruthy();
    expect(screen.queryByText(/AI summary/i)).toBeNull();
    expect(apiGet).toHaveBeenCalledWith('/api/insights?range=30d');
  });

  it('expands evidence rendered from API references only', async () => {
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getByText('Activity momentum')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'View evidence' }));

    expect(screen.getByText('Repository')).toBeTruthy();
    expect(screen.getByText('64b64b64b64b64b64b64b64b')).toBeTruthy();
    expect(screen.getByText('abcdef123456')).toBeTruthy();
    expect(screen.getByText('#42')).toBeTruthy();
    // Repository evidence links to the user's own detail route.
    expect(screen.getByRole('link', { name: '64b64b64b64b64b64b64b64b' }).getAttribute('href')).toBe(
      '/repositories/64b64b64b64b64b64b64b64b'
    );
  });

  it('shows the empty state when no insights are stored', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      return { insights: [] };
    });
    renderInsights(['/insights']);

    await waitFor(() => expect(screen.getByText('Not enough data for insights yet')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'View evidence' })).toBeNull();
  });

  it('shows an error state with retry', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (apiGet.mock.calls.filter((c) => c[0] === url).length > 1)
        return { insights: [API_FIXTURES.insight] };
      throw new Error('offline');
    });
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getByText('Could not load insights')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Activity momentum')).toBeTruthy());
  });

  it('range selection is URL-synced and refetches', async () => {
    const { user } = renderInsights(['/insights?range=30d']);

    await waitFor(() => expect(screen.getByText('Activity momentum')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '12m' }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/insights?range=12m'));
  });
});

describe('Insights Explain interaction (T6.2)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    window.localStorage.clear();
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/insights')) {
        return {
          insights: [
            API_FIXTURES.insight,
            {
              ...API_FIXTURES.insight,
              id: '64b64b64b64b64b64b64b642',
              templateId: 'quiet-period',
              title: 'Quiet period',
              text: 'You had 3 quiet stretches in the last 30 days.',
            },
          ],
        };
      }
      return {};
    });
  });

  it('shows an Explain button on load and fires no AI request', async () => {
    renderInsights(['/insights']);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('clicking Explain calls the explain endpoint and shows the AI summary well', async () => {
    apiPost.mockResolvedValue({
      paraphrase: 'Commit activity grew compared with the previous month.',
      whyItMatters: 'Steady growth suggests sustained focus.',
      aiLabel: true,
    });
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2));
    await user.click(screen.getAllByRole('button', { name: 'Explain' })[0]);

    await waitFor(() => expect(screen.getByText('AI summary (beta)')).toBeTruthy());
    expect(apiPost).toHaveBeenCalledWith(`/api/insights/${INSIGHT_ID}/explain`);
    expect(screen.getByText('Commit activity grew compared with the previous month.')).toBeTruthy();
    expect(screen.getByText('Steady growth suggests sustained focus.')).toBeTruthy();
    // Evidence adjacency: the AI block is never orphaned.
    expect(screen.getAllByRole('button', { name: 'View evidence' }).length).toBeGreaterThanOrEqual(1);
  });

  it('shows a loading state with a disabled button during the request', async () => {
    let resolveExplain;
    apiPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExplain = () => resolve({ paraphrase: 'ok', aiLabel: true });
        })
    );
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2));
    await user.click(screen.getAllByRole('button', { name: 'Explain' })[0]);

    await waitFor(() => expect(screen.getByRole('button', { name: /Explaining…/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Explaining…/ }).disabled).toBe(true);

    await waitFor(() => {
      resolveExplain();
    });
    await waitFor(() => expect(screen.getByText('AI summary (beta)')).toBeTruthy());
  });

  it('does NOT label a deterministic fallback as AI-generated', async () => {
    apiPost.mockResolvedValue({ paraphrase: 'template text', aiLabel: false });
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2));
    await user.click(screen.getAllByRole('button', { name: 'Explain' })[0]);

    await waitFor(() =>
      expect(screen.getByText('AI summary unavailable — showing the computed summary.')).toBeTruthy()
    );
    expect(screen.queryByText('AI summary (beta)')).toBeNull();
    // The deterministic insight is untouched.
    expect(screen.getByText('Commits are up 12% versus the prior period.')).toBeTruthy();
  });

  it('keeps the insight visible when the provider fails (error is non-blocking)', async () => {
    apiPost.mockRejectedValue(new Error('network down'));
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2));
    await user.click(screen.getAllByRole('button', { name: 'Explain' })[0]);

    await waitFor(() =>
      expect(
        screen.getByText('Could not load an AI summary. The computed summary above stands.')
      ).toBeTruthy()
    );
    expect(screen.getByText('Commits are up 12% versus the prior period.')).toBeTruthy();
    expect(screen.queryByText('AI summary (beta)')).toBeNull();
  });

  it('treats a server AI-disabled response as unavailable (subtle caption, no error card, no retry)', async () => {
    const err = new Error('AI explanations are not enabled.');
    err.code = 'AI_DISABLED';
    err.status = 501;
    apiPost.mockRejectedValue(err);
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2));
    await user.click(screen.getAllByRole('button', { name: 'Explain' })[0]);

    // design_system.md §26: AI unavailable → subtle caption, no error card, no retry loop.
    await waitFor(() =>
      expect(screen.getByText('AI summary unavailable — showing the computed summary.')).toBeTruthy()
    );
    expect(screen.queryByText(/Could not load an AI summary/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Explaining…/ })).toBeNull(); // loading cleared
    expect(screen.queryByText('AI summary (beta)')).toBeNull(); // no fake AI explanation
    // The deterministic insight is untouched.
    expect(screen.getByText('Commits are up 12% versus the prior period.')).toBeTruthy();
    // The Explain action is still available again (no stuck state).
    expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2);
  });

  it('hides the Explain button and fires no request when the preference is off', async () => {
    window.localStorage.setItem('frieday.aiExplanations', 'false');
    renderInsights(['/insights']);

    await waitFor(() =>
      expect(screen.getAllByText('AI explanations are turned off in Settings.').length).toBe(2)
    );
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('keeps explanations independent per insight card', async () => {
    apiPost.mockImplementation(async (url) => {
      if (url.includes(INSIGHT_ID)) {
        return { paraphrase: 'first explanation', aiLabel: true };
      }
      return { paraphrase: 'second explanation', aiLabel: true };
    });
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2));
    await user.click(screen.getAllByRole('button', { name: 'Explain' })[0]);

    await waitFor(() => expect(screen.getByText('first explanation')).toBeTruthy());
    expect(screen.queryByText('second explanation')).toBeNull();
    // The second card still shows its own Explain action.
    expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(1);
  });

  it('offers retry after a failed explanation', async () => {
    apiPost.mockRejectedValueOnce(new Error('network down'));
    apiPost.mockResolvedValueOnce({ paraphrase: 'recovered explanation', aiLabel: true });
    const { user } = renderInsights(['/insights']);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Explain' }).length).toBe(2));
    await user.click(screen.getAllByRole('button', { name: 'Explain' })[0]);

    await waitFor(() =>
      expect(
        screen.getByText('Could not load an AI summary. The computed summary above stands.')
      ).toBeTruthy()
    );

    // The Explain action is available again after failure.
    const explain = screen.getAllByRole('button', { name: 'Explain' });
    expect(explain.length).toBe(1);
    await user.click(explain[0]);
    await waitFor(() => expect(screen.getByText('recovered explanation')).toBeTruthy());
  });
});
