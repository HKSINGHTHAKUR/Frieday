import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import SyncProgress from '../components/domain/SyncProgress.jsx';
import { useSync, SyncProvider } from '../store/SyncStore.jsx';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
import { apiGet, apiPost } from '../lib/apiClient.js';

/** Harness: re-render on every sync context change so assertions see state. */
function Harness() {
  const sync = useSync();
  return (
    <div>
      <SyncProgress />
      <span data-testid="status">{sync.status}</span>
    </div>
  );
}

function renderHarness() {
  return render(
    <SyncProvider>
      <Harness />
    </SyncProvider>
  );
}

async function advanceTimers(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('SyncProgress global sync UX (T5.3)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing for an idle sync (no fake progress)', async () => {
    apiGet.mockResolvedValue({ status: 'idle', perResource: {}, resources: {}, history: [] });
    renderHarness();
    await advanceTimers(0);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows live progress while a sync runs and polls every 2 seconds', async () => {
    apiGet
      .mockResolvedValueOnce({
        status: 'running',
        phase: 'commits',
        done: 45,
        total: 120,
        perResource: {},
        resources: {},
        history: [],
      })
      .mockResolvedValue({
        status: 'succeeded',
        phase: null,
        done: 120,
        total: 120,
        perResource: {},
        resources: {},
        history: [],
      });

    renderHarness();
    await advanceTimers(0);

    expect(screen.getByText(/Syncing commits 45\/120/)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('45');

    await advanceTimers(2000);
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Sync complete')).toBeTruthy();
  });

  it('shows the rate-limit resume message with the resume time', async () => {
    const resumeAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    apiGet.mockResolvedValue({
      status: 'failed',
      error: { code: 'RATE_LIMITED', message: 'GitHub rate limit reached.' },
      resumeAt,
      perResource: {},
      resources: {},
      history: [],
    });

    renderHarness();
    await advanceTimers(0);

    expect(screen.getByText(/GitHub rate limit reached\. Resumes automatically at/)).toBeTruthy();
    const time = resumeAt;
    expect(
      screen.getByText(
        new RegExp(new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
      )
    ).toBeTruthy();
  });

  it('shows a clear reconnect state for a revoked/expired GitHub token (no retry loop)', async () => {
    apiGet.mockResolvedValue({
      status: 'failed',
      error: { code: 'UNAUTHENTICATED', message: 'GitHub connection expired.' },
      perResource: {},
      resources: {},
      history: [],
    });

    renderHarness();
    await advanceTimers(0);

    // design_system.md §26: clear reconnect guidance, no generic error, no retry loop.
    expect(screen.getByText('GitHub connection expired')).toBeTruthy();
    expect(screen.getByText(/Reconnect GitHub to continue syncing/)).toBeTruthy();
    const reconnect = screen.getByRole('link', { name: 'Reconnect GitHub' });
    expect(reconnect.getAttribute('href')).toBe('/api/auth/github');
    // No generic retry that would loop on a permanently invalid credential.
    expect(screen.queryByRole('button', { name: 'Retry sync' })).toBeNull();
    expect(screen.queryByText(/Sync failed:/)).toBeNull();
  });

  it('keeps a retryable generic failure on the retry path (UNAUTHENTICATED is not over-broad)', async () => {
    apiGet.mockResolvedValue({
      status: 'failed',
      error: { code: 'GITHUB_UNREACHABLE', message: 'GitHub is temporarily unreachable.', retryable: true },
      perResource: {},
      resources: {},
      history: [],
    });

    renderHarness();
    await advanceTimers(0);

    expect(screen.getByText(/Sync failed: GitHub is temporarily unreachable\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry sync' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Reconnect GitHub' })).toBeNull();
  });

  it('shows per-resource warnings for partial failure without faking success', async () => {
    apiGet.mockResolvedValue({
      status: 'succeeded',
      perResource: { languages: { status: 'failed', error: 'Timeout on tester/app' } },
      resources: {},
      history: [],
    });

    renderHarness();
    await advanceTimers(0);

    expect(screen.getByText(/Timeout on tester\/app/)).toBeTruthy();
    expect(screen.getByText('Warning')).toBeTruthy();
    expect(screen.getByText('Sync complete')).toBeTruthy();
  });

  it('stops polling after a terminal status and does not poll on unmount', async () => {
    apiGet.mockResolvedValue({
      status: 'running',
      done: 1,
      total: 2,
      perResource: {},
      resources: {},
      history: [],
    });
    const { unmount } = renderHarness();

    await advanceTimers(0);
    expect(apiGet).toHaveBeenCalledTimes(1);

    await advanceTimers(2000);
    expect(apiGet).toHaveBeenCalledTimes(2);

    unmount();
    await advanceTimers(10000);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
