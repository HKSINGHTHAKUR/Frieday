import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useSyncStatus } from './useSyncStatus.js';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
}));
import { apiGet } from '../lib/apiClient.js';

function Harness({ onState }) {
  const s = useSyncStatus();
  onState(s);
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="progress">
        {s.progress.done}/{s.progress.total}
      </span>
    </div>
  );
}

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useSyncStatus (T5.2 polling)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls /api/sync/status every 2s while syncing, then stops on done', async () => {
    apiGet
      .mockResolvedValueOnce({ status: 'queued', phase: 'repositories', done: 0, total: 5 })
      .mockResolvedValueOnce({ status: 'running', phase: 'commits', done: 2, total: 5 })
      .mockResolvedValue({ status: 'succeeded', phase: null, done: 5, total: 5 });

    const ref = { current: null };
    const { unmount } = render(<Harness onState={(s) => (ref.current = s)} />);

    // First tick happens on mount
    await advance(0);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(ref.current.status).toBe('queued');
    expect(ref.current.progress).toEqual({ done: 0, total: 5 });

    // Poll again after ~2s while still running
    await advance(2000);
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(ref.current.status).toBe('running');
    expect(ref.current.progress).toEqual({ done: 2, total: 5 });

    // Terminal status reached on third tick
    await advance(2000);
    expect(apiGet).toHaveBeenCalledTimes(3);
    expect(ref.current.status).toBe('succeeded');

    // No further polling after terminal status
    await advance(10000);
    expect(apiGet).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('stops polling on unmount (no further polls)', async () => {
    apiGet.mockResolvedValue({ status: 'running', done: 0, total: 1 });

    const { unmount } = render(<Harness onState={() => {}} />);
    await advance(0);
    expect(apiGet).toHaveBeenCalledTimes(1);

    unmount();
    await advance(10000);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('treats a failed status read as an error state without crashing or crashing polling', async () => {
    apiGet.mockRejectedValue(new Error('network down'));

    const ref = { current: null };
    render(<Harness onState={(s) => (ref.current = s)} />);
    await advance(0);

    expect(ref.current.status).toBe('idle');
    expect(ref.current.error).toBeTruthy();
    // A failed read must not leave an infinite polling loop
    await advance(10000);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
