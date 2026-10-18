import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import InsightsCard from './InsightsCard.jsx';

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

/**
 * Aggregate insight (dashboard path): no persisted id, no repoId.
 */
const AGGREGATE_INSIGHT = {
  templateId: 'activity_momentum',
  title: 'Activity momentum',
  text: 'Commits are up 12% versus the prior period.',
  metrics: { commits: 120 },
  evidence: { bucketStarts: ['2026-09-01T00:00:00Z'] },
  confidence: 'High',
};

/**
 * Per-repo project_health insight: no persisted id on the dashboard path,
 * but metrics.repoId distinguishes it from other per-repo insights sharing
 * the same templateId.
 */
const PROJECT_HEALTH_REPO_A = {
  templateId: 'project_health',
  title: 'Project Health',
  text: 'me/app revived — moved from quiet to active.',
  metrics: {
    repoId: '64b64b64b64b64b64b64b64b',
    repoName: 'me/app',
    previousHealth: 'quiet',
    currentHealth: 'active',
  },
  evidence: { repoIds: ['64b64b64b64b64b64b64b64b'] },
  confidence: 'High',
};

const PROJECT_HEALTH_REPO_B = {
  templateId: 'project_health',
  title: 'Project Health',
  text: 'me/web went quiet — moved from active to quiet.',
  metrics: {
    repoId: '64b64b64b64b64b64b64b642',
    repoName: 'me/web',
    previousHealth: 'active',
    currentHealth: 'quiet',
  },
  evidence: { repoIds: ['64b64b64b64b64b64b64b642'] },
  confidence: 'High',
};

describe('InsightsCard (T5.3)', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('labels deterministic insights as "Product insight", not "AI summary (beta)"', () => {
    render(<InsightsCard insights={[AGGREGATE_INSIGHT]} />);

    expect(screen.getByText('Product insight')).toBeTruthy();
    expect(screen.queryByText(/AI summary/i)).toBeNull();
  });

  it('renders multiple per-repo project_health insights sharing a templateId without duplicate keys', () => {
    render(<InsightsCard insights={[PROJECT_HEALTH_REPO_A, PROJECT_HEALTH_REPO_B]} />);

    expect(screen.getByText('me/app')).toBeTruthy();
    expect(screen.getByText('me/web')).toBeTruthy();
    // Both cards render despite identical templateId — no duplicate-key drop.
    expect(screen.getAllByText('Project Health')).toHaveLength(2);
  });

  it('emits no duplicate-key React warnings for co-located per-repo insights', () => {
    render(<InsightsCard insights={[PROJECT_HEALTH_REPO_A, PROJECT_HEALTH_REPO_B]} />);

    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter((call) =>
      String(call[0]).includes('Warning: Encountered two children with the same key')
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
  });
});
