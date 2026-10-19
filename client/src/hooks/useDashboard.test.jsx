import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useDashboard } from './useDashboard.js';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
}));
import { apiGet } from '../lib/apiClient.js';

function Harness() {
  const dash = useDashboard();
  const location = useLocation();
  return (
    <div>
      <span data-testid="search">{location.search}</span>
      <span data-testid="range">{dash.range}</span>
      <span data-testid="data">{dash.data ? dash.data.ok : ''}</span>
      <span data-testid="loading">{String(dash.loading)}</span>
      <span data-testid="error">{dash.error ? dash.error.message : ''}</span>
      <button onClick={() => dash.setRange('30d')}>set-30d</button>
      <button onClick={() => dash.setRange('90d')}>set-90d</button>
      <button onClick={() => dash.setRange('12m')}>set-12m</button>
      <button onClick={() => dash.setRange('bogus')}>set-bad</button>
    </div>
  );
}

function renderHarness(initialSearch) {
  return render(
    <MemoryRouter initialEntries={[`/${initialSearch}`]}>
      <Harness />
    </MemoryRouter>
  );
}

describe('useDashboard (T5.2 range URL sync)', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('defaults to 30d and requests the dashboard API with that range', async () => {
    apiGet.mockResolvedValue({ ok: 'payload-1' });
    renderHarness('');

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('range').textContent).toBe('30d');
    expect(apiGet).toHaveBeenCalledWith('/api/dashboard?range=30d');
    expect(screen.getByTestId('data').textContent).toBe('payload-1');
  });

  it('reads an allowed range from the URL and uses it in the request', async () => {
    apiGet.mockResolvedValue({ ok: 'payload-90' });
    renderHarness('?range=90d');

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/dashboard?range=90d'));
    expect(screen.getByTestId('range').textContent).toBe('90d');
  });

  it('falls back to 30d for a disallowed URL range', async () => {
    apiGet.mockResolvedValue({ ok: 'x' });
    renderHarness('?range=hacky');

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/dashboard?range=30d'));
    expect(screen.getByTestId('range').textContent).toBe('30d');
  });

  it('setRange updates the URL search params and refetches with the new range', async () => {
    apiGet.mockResolvedValue({ ok: 'payload' });
    const user = userEvent.setup();
    renderHarness('?range=30d');

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/dashboard?range=30d'));

    await user.click(screen.getByText('set-12m'));

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/dashboard?range=12m'));
    expect(screen.getByTestId('range').textContent).toBe('12m');
    expect(screen.getByTestId('search').textContent).toBe('?range=12m');
  });

  it('ignores an invalid range passed to setRange (URL unchanged, no refetch)', async () => {
    apiGet.mockResolvedValue({ ok: 'payload' });
    const user = userEvent.setup();
    renderHarness('?range=30d');
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    await user.click(screen.getByText('set-bad'));

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('range').textContent).toBe('30d');
    expect(screen.getByTestId('search').textContent).toBe('?range=30d');
  });

  it('rapid range change: only latest range data is displayed, stale responses discarded', async () => {
    let resolve30d, resolve90d, resolve12m;
    const p30d = new Promise((r) => {
      resolve30d = r;
    });
    const p90d = new Promise((r) => {
      resolve90d = r;
    });
    const p12m = new Promise((r) => {
      resolve12m = r;
    });

    apiGet.mockImplementation((url) => {
      if (url.includes('range=30d')) return p30d;
      if (url.includes('range=90d')) return p90d;
      if (url.includes('range=12m')) return p12m;
      return Promise.resolve({ ok: 'default' });
    });

    const user = userEvent.setup();
    renderHarness('?range=30d');

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/dashboard?range=30d'));

    // Fire rapid range changes: 30d -> 90d -> 12m
    await user.click(screen.getByText('set-90d'));
    await user.click(screen.getByText('set-12m'));

    // Resolve the slowest (first) request last — it must be discarded.
    resolve30d({ ok: 'stale-30d' });
    // Resolve the middle request — must also be discarded.
    resolve90d({ ok: 'stale-90d' });
    // Resolve the latest request — this is the only one that should display.
    resolve12m({ ok: 'payload-12m' });

    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('payload-12m'));
    expect(screen.getByTestId('range').textContent).toBe('12m');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('stale error response does not overwrite successful latest response', async () => {
    let resolve30d, resolve90d;
    const p30d = new Promise((r) => {
      resolve30d = r;
    });
    const p90d = new Promise((r) => {
      resolve90d = r;
    });

    apiGet.mockImplementation((url) => {
      if (url.includes('range=30d')) return p30d;
      if (url.includes('range=90d')) return p90d;
      return Promise.resolve({ ok: 'default' });
    });

    const user = userEvent.setup();
    renderHarness('?range=30d');

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/dashboard?range=30d'));

    await user.click(screen.getByText('set-90d'));

    // First (30d) request errors — stale, must be discarded.
    resolve30d(Promise.reject(new Error('boom-30d')));
    // Latest (90d) request succeeds.
    resolve90d({ ok: 'payload-90d' });

    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('payload-90d'));
    expect(screen.getByTestId('error').textContent).toBe('');
    expect(screen.getByTestId('range').textContent).toBe('90d');
  });
});
