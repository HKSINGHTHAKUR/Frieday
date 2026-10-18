import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings, { overallLastSyncedAt } from './Settings.jsx';
import { TestProviders, fakeAuth, API_FIXTURES } from '../test/helpers.jsx';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));
import { apiGet, apiPost } from '../lib/apiClient.js';

function renderSettings() {
  const user = userEvent.setup();
  return {
    user,
    ...render(
      <TestProviders initialEntries={['/settings']}>
        <Settings />
      </TestProviders>
    ),
  };
}

describe('Settings page (T5.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) {
        return {
          ...API_FIXTURES.syncIdle,
          resources: {
            repos: { status: 'done', lastSyncedAt: '2026-10-04T10:00:00Z', error: null },
            commits: { status: 'done', lastSyncedAt: '2026-10-04T10:05:00Z', error: null },
          },
          history: [
            {
              jobId: 'j1',
              kind: 'initial',
              status: 'succeeded',
              startedAt: '2026-10-04T10:00:00Z',
              finishedAt: '2026-10-04T10:06:00Z',
              error: null,
            },
          ],
        };
      }
      return {};
    });
  });

  it('renders profile, scopes, and per-resource sync status', async () => {
    renderSettings();

    await waitFor(() => expect(screen.getByText('tester')).toBeTruthy());
    expect(screen.getByText('Token active')).toBeTruthy();
    expect(screen.getByText('repo')).toBeTruthy();
    expect(screen.getByText('Per-resource status')).toBeTruthy();
    expect(screen.getByText('Recent syncs')).toBeTruthy();
    expect(screen.getByText('succeeded')).toBeTruthy();
  });

  it('Resync posts /api/sync and surfaces success via toast', async () => {
    apiPost.mockResolvedValue({ jobId: 'j2', status: 'running' });
    const { user } = renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resync now' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Resync now' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/sync'));
    await waitFor(() => expect(screen.getByText('Resync started.')).toBeTruthy());
  });

  it('surfaces the sync conflict state instead of creating a duplicate job', async () => {
    apiPost.mockImplementation(() => {
      const err = new Error('A sync is already running.');
      err.code = 'SYNC_CONFLICT';
      err.status = 409;
      throw err;
    });
    const { user } = renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resync now' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Resync now' }));

    await waitFor(() => expect(screen.getByText('A sync is already running.')).toBeTruthy());
    // No new job was created: exactly one POST attempt was made.
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('Disconnect requires confirmation, then calls the endpoint', async () => {
    fakeAuth.disconnect.mockResolvedValue(undefined);
    const { user } = renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect GitHub' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));

    // Confirmation modal appears first; no disconnect call yet.
    expect(await screen.findByRole('dialog', { name: 'Disconnect GitHub?' })).toBeTruthy();
    expect(fakeAuth.disconnect).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(fakeAuth.disconnect).toHaveBeenCalledTimes(1));
  });

  it('Cancel on the disconnect modal keeps the session intact', async () => {
    const { user } = renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect GitHub' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(fakeAuth.disconnect).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Disconnect GitHub?' })).toBeNull();
  });

  it('Delete data is separate, confirmed, and calls DELETE /api/auth/data', async () => {
    fakeAuth.deleteData.mockResolvedValue(undefined);
    const { user } = renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete all data' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Delete all data' }));

    expect(await screen.findByRole('dialog', { name: 'Delete all synced data?' })).toBeTruthy();
    expect(fakeAuth.deleteData).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    await waitFor(() => expect(fakeAuth.deleteData).toHaveBeenCalledTimes(1));
    // Disconnect must NOT have been invoked by the delete flow.
    expect(fakeAuth.disconnect).not.toHaveBeenCalled();
  });

  it('shows the expired-connection reconnect state when disconnected', async () => {
    render(
      <TestProviders initialEntries={['/settings']} auth={{ ...fakeAuth, connected: false }}>
        <Settings />
      </TestProviders>
    );

    expect(await screen.findByText('GitHub connection expired.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconnect' }).getAttribute('href')).toBe('/api/auth/github');
  });

  it('derives the overall last-synced as the max across resource timestamps', () => {
    expect(
      overallLastSyncedAt({
        repos: { lastSyncedAt: '2026-10-04T10:00:00Z' },
        commits: { lastSyncedAt: '2026-10-04T10:05:00Z' },
        issues: { lastSyncedAt: null },
      })
    ).toBe(Date.parse('2026-10-04T10:05:00Z'));
    expect(overallLastSyncedAt({ repos: { lastSyncedAt: null } })).toBeNull();
    expect(overallLastSyncedAt(undefined)).toBeNull();
    expect(overallLastSyncedAt({})).toBeNull();
  });

  it('top-level Last synced reflects the most recent resource sync (not the boot-time /me value)', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-05T12:00:00Z'));

    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) {
        return {
          ...API_FIXTURES.syncIdle,
          resources: {
            repos: { status: 'done', lastSyncedAt: '2026-10-05T10:00:00Z', error: null },
            commits: { status: 'done', lastSyncedAt: '2026-10-05T11:00:00Z', error: null },
          },
        };
      }
      return {};
    });
    renderSettings();

    await waitFor(() => expect(screen.getByText('Per-resource status')).toBeTruthy());
    // fakeAuth.lastSyncedAt is 2026-10-01 (boot-time snapshot); the live
    // resource rows are newer, so the top-level must follow the resources.
    expect(screen.getByText(/Last synced 1h ago/)).toBeTruthy();
    expect(screen.queryByText(/Last synced 4d ago/)).toBeNull();

    nowSpy.mockRestore();
  });
});
