/**
 * Repositories page — Phase 10.2 per-repository theme chip + drill-down.
 *
 * Covers: chip rendering, deterministic top-theme label, the drill-down panel
 * (denominator, confidence, buckets, samples), and the honest empty states
 * (no themed commits → no chip; no repoThemes at all → row unchanged).
 */
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

const REPO_ID = '64b64b64b64b64b64b64b64b';

/** A per-repository theme payload in the Phase 10.2 server shape. */
function themePayload(overrides = {}) {
  return {
    version: 1,
    rulesVersion: 1,
    totalCommits: 12,
    themedCommits: 10,
    unclassified: 1,
    noMessage: 0,
    noise: 1,
    items: [
      {
        theme: 'Bug fix',
        confidence: 'High',
        commitCount: 7,
        share: 0.7,
        evidence: { repoNames: ['tester/app'], commitShas: ['a1'], sampleMessages: ['fix: crash'] },
      },
      {
        theme: 'Feature',
        confidence: 'Medium',
        commitCount: 3,
        share: 0.3,
        evidence: { repoNames: ['tester/app'], commitShas: ['b1'], sampleMessages: ['feat: add'] },
      },
    ],
    topTheme: { theme: 'Bug fix', commitCount: 7, share: 0.7, confidence: 'High' },
    ...overrides,
  };
}

function pageWithThemes(repoThemes) {
  return {
    items: [API_FIXTURES.repoItem],
    nextCursor: null,
    hasMore: false,
    repoThemes,
  };
}

function renderRepos() {
  const user = userEvent.setup();
  return {
    user,
    ...render(
      <TestProviders initialEntries={['/repositories']}>
        <Repositories />
      </TestProviders>
    ),
  };
}

describe('Repositories — per-repository themes (Phase 10.2)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/repos')) return pageWithThemes({ [REPO_ID]: themePayload() });
      return {};
    });
  });

  it('renders a top-theme chip with the theme name and commit count', async () => {
    renderRepos();

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    expect(screen.getByText('Bug fix · 7 commits')).toBeTruthy();
    expect(screen.getByText('70% of themed commits')).toBeTruthy();
  });

  it('opens the drill-down panel showing the denominator, themes and buckets', async () => {
    const { user } = renderRepos();

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /View themes/ }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Commit themes for tester/app' })).toBeTruthy()
    );
    // The denominator is visible.
    expect(screen.getByText('of 10 themed commits')).toBeTruthy();
    // Both themes are listed with their confidence.
    expect(screen.getAllByText('Bug fix').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Feature').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
    // Non-theme buckets are surfaced, not hidden.
    expect(screen.getByText(/1 unclassified/)).toBeTruthy();
    expect(screen.getByText(/1 maintenance/)).toBeTruthy();
    // The honesty disclaimer is present.
    expect(screen.getByText(/describe what you wrote, not what you are skilled at/i)).toBeTruthy();
  });

  it('the drill-down can be closed again', async () => {
    const { user } = renderRepos();

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /View themes/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Hide themes/ })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Hide themes/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /View themes/ })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Commit themes for tester/app' })).toBeNull();
  });

  it('a repository with no themed commits gets NO chip and no drill-down', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/repos')) {
        return pageWithThemes({
          [REPO_ID]: themePayload({
            totalCommits: 4,
            themedCommits: 0,
            unclassified: 2,
            noMessage: 1,
            noise: 1,
            items: [],
            topTheme: null,
          }),
        });
      }
      return {};
    });
    renderRepos();

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    // No chip, no "View themes" affordance — nothing is invented.
    expect(screen.queryByText(/Bug fix ·/)).toBeNull();
    expect(screen.queryByRole('button', { name: /View themes/ })).toBeNull();
  });

  it('a repository with an empty theme payload still renders its row normally', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/repos')) {
        return pageWithThemes({
          [REPO_ID]: themePayload({
            totalCommits: 0,
            themedCommits: 0,
            unclassified: 0,
            noMessage: 0,
            noise: 0,
            items: [],
            topTheme: null,
          }),
        });
      }
      return {};
    });
    renderRepos();

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /View themes/ })).toBeNull();
  });

  it('a response with no repoThemes map leaves the row exactly as before', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/repos')) {
        return { items: [API_FIXTURES.repoItem], nextCursor: null, hasMore: false };
      }
      return {};
    });
    renderRepos();

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /View themes/ })).toBeNull();
    expect(screen.queryByText(/of \d+ themed commits/)).toBeNull();
  });

  it('the chip uses a singular label for a single commit', async () => {
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/repos')) {
        return pageWithThemes({
          [REPO_ID]: themePayload({
            totalCommits: 1,
            themedCommits: 1,
            unclassified: 0,
            noMessage: 0,
            noise: 0,
            items: [
              {
                theme: 'Documentation',
                confidence: 'Low',
                commitCount: 1,
                share: 1,
                evidence: { repoNames: ['tester/app'], commitShas: ['a1'], sampleMessages: ['docs: x'] },
              },
            ],
            topTheme: { theme: 'Documentation', commitCount: 1, share: 1, confidence: 'Low' },
          }),
        });
      }
      return {};
    });
    renderRepos();

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    expect(screen.getByText('Documentation · 1 commit')).toBeTruthy();
  });

  it('sorting and pagination still work with themes present', async () => {
    const { user } = renderRepos();

    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Recent' }));

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/api/repos?sort=recent&limit=50&includeThemes=true')
    );
  });

  it('two open drill-down panels have UNIQUE heading ids and accessible names (a11y regression)', async () => {
    // Regression: every per-repo panel used the same constant heading id, so
    // two simultaneously-open panels produced duplicate ids and
    // aria-labelledby resolved to the wrong heading. The ACCESSIBLE NAME of
    // the landmark must be unique too — two landmarks both named "Commit
    // themes for this repository" are indistinguishable (axe
    // `landmark-unique`).
    const SECOND_ID = '64b64b64b64b64b64b64b64c';
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/repos')) {
        return {
          items: [API_FIXTURES.repoItem, { ...API_FIXTURES.repoItem, id: SECOND_ID, fullName: 'tester/web' }],
          nextCursor: null,
          hasMore: false,
          repoThemes: {
            [REPO_ID]: themePayload(),
            [SECOND_ID]: themePayload({
              items: [
                {
                  theme: 'Security',
                  confidence: 'Medium',
                  commitCount: 6,
                  share: 1,
                  evidence: { repoNames: ['tester/web'], commitShas: ['x1'], sampleMessages: ['fix: x'] },
                },
              ],
              topTheme: { theme: 'Security', commitCount: 6, share: 1, confidence: 'Medium' },
            }),
          },
        };
      }
      return {};
    });

    const { user } = renderRepos();
    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());

    // Open BOTH panels.
    const buttons = screen.getAllByRole('button', { name: /View themes/ });
    expect(buttons.length).toBe(2);
    await user.click(buttons[0]);
    await user.click(buttons[1]);

    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { name: /^Commit themes for / });
      expect(headings.length).toBe(2);
      const ids = headings.map((h) => h.id);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(2, 'each open panel must have a unique heading id');

      // The accessible NAMES must differ too, and each must name its
      // repository.
      const names = headings.map((h) => h.textContent);
      expect(new Set(names).size).toBe(2, 'each open panel must have a unique accessible name');
      expect(names).toContain('Commit themes for tester/app');
      expect(names).toContain('Commit themes for tester/web');
    });
  });

  it('each disclosure button names the repository it opens', async () => {
    const SECOND_ID = '64b64b64b64b64b64b64b64c';
    apiGet.mockImplementation(async (url) => {
      if (url.includes('/api/sync/status')) return API_FIXTURES.syncIdle;
      if (url.includes('/api/repos')) {
        return {
          items: [API_FIXTURES.repoItem, { ...API_FIXTURES.repoItem, id: SECOND_ID, fullName: 'tester/web' }],
          nextCursor: null,
          hasMore: false,
          repoThemes: {
            [REPO_ID]: themePayload(),
            [SECOND_ID]: themePayload(),
          },
        };
      }
      return {};
    });

    renderRepos();
    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());

    // Each toggle is individually addressable by screen readers.
    expect(screen.getByRole('button', { name: 'tester/app: View themes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tester/web: View themes' })).toBeTruthy();
  });

  it('aria-expanded and aria-controls point at the real panel', async () => {
    const { user } = renderRepos();
    await waitFor(() => expect(screen.getByText('tester/app')).toBeTruthy());

    const toggle = screen.getByRole('button', { name: /View themes/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId)).toBeNull();

    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole('button', { name: /Hide themes/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Hide themes/ }).getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(panelId);
    expect(panel).toBeTruthy();
    expect(panel.querySelector('h2')).toBeTruthy();
  });
});
