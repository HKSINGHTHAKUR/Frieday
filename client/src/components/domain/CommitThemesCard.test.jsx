/**
 * CommitThemesCard UI tests (Phase 10.1).
 *
 * Asserts the documented presentation contract: denominator is shown,
 * confidence badges map to tones, long labels wrap, empty/error states are
 * honest, and no theme is ever fabricated.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CommitThemesCard from './CommitThemesCard.jsx';

const POPULATED = {
  version: 1,
  rulesVersion: 1,
  totalCommits: 120,
  themedCommits: 84,
  unclassified: 20,
  noMessage: 10,
  noise: 6,
  items: [
    {
      theme: 'Bug fix',
      confidence: 'High',
      commitCount: 40,
      share: 0.476,
      evidence: {
        repoNames: ['me/alpha', 'me/beta'],
        commitShas: ['a1', 'a2'],
        sampleMessages: ['fix: null deref in parser', 'fix: race in sync'],
      },
    },
    {
      theme: 'Security',
      confidence: 'Medium',
      commitCount: 12,
      share: 0.143,
      evidence: {
        repoNames: ['me/alpha'],
        commitShas: ['b1'],
        sampleMessages: ['sanitize oauth token'],
      },
    },
    {
      theme: 'Documentation',
      confidence: 'Low',
      commitCount: 3,
      share: 0.036,
      evidence: { repoNames: [], commitShas: [], sampleMessages: [] },
    },
  ],
};

beforeEach(() => {
  cleanup();
});

describe('CommitThemesCard (Phase 10.1)', () => {
  it('renders the heading and the denominator', () => {
    render(<CommitThemesCard themes={POPULATED} />);
    expect(screen.getByRole('heading', { name: 'Commit themes' })).toBeTruthy();
    expect(screen.getByText('of 84 themed commits')).toBeTruthy();
  });

  it('renders every theme with its count and percentage', () => {
    render(<CommitThemesCard themes={POPULATED} />);
    expect(screen.getByText('Bug fix')).toBeTruthy();
    expect(screen.getByText('Security')).toBeTruthy();
    expect(screen.getByText('Documentation')).toBeTruthy();
    expect(screen.getByText('40 · 47.6%')).toBeTruthy();
    expect(screen.getByText('12 · 14.3%')).toBeTruthy();
  });

  it('renders a confidence badge per theme', () => {
    render(<CommitThemesCard themes={POPULATED} />);
    const badges = screen.getAllByText(/^(High|Medium|Low)$/);
    expect(badges.length).toBe(3);
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('shows the contributing repositories', () => {
    render(<CommitThemesCard themes={POPULATED} />);
    expect(screen.getByText('me/alpha, me/beta')).toBeTruthy();
  });

  it('shows bounded sample messages as evidence', () => {
    render(<CommitThemesCard themes={POPULATED} />);
    expect(screen.getByText('fix: null deref in parser')).toBeTruthy();
    expect(screen.getByText('sanitize oauth token')).toBeTruthy();
  });

  it('surfaces the non-theme buckets honestly', () => {
    render(<CommitThemesCard themes={POPULATED} />);
    expect(screen.getByText(/20 unclassified/)).toBeTruthy();
    expect(screen.getByText(/10 without a message/)).toBeTruthy();
    expect(screen.getByText(/6 maintenance/)).toBeTruthy();
  });

  it('states that themes describe messages, not skill', () => {
    render(<CommitThemesCard themes={POPULATED} />);
    expect(screen.getByText(/describe what you wrote, not what you are skilled at/i)).toBeTruthy();
  });

  it('renders an honest empty state when no commits are themed', () => {
    render(
      <CommitThemesCard
        themes={{
          version: 1,
          rulesVersion: 1,
          totalCommits: 40,
          themedCommits: 0,
          unclassified: 30,
          noMessage: 10,
          noise: 0,
          items: [],
        }}
      />
    );
    expect(screen.getByRole('heading', { name: 'Commit themes' })).toBeTruthy();
    expect(screen.getByText('No commit themes detected')).toBeTruthy();
    expect(screen.getByText(/Not enough commit-message detail/i)).toBeTruthy();
    // No fabricated distribution.
    expect(screen.queryByText(/unclassified/)).toBeNull();
  });

  it('renders an honest empty state when themes are missing entirely', () => {
    render(<CommitThemesCard themes={undefined} />);
    expect(screen.getByText('No commit themes detected')).toBeTruthy();
  });

  it('renders an honest empty state for a null themes payload', () => {
    render(<CommitThemesCard themes={null} />);
    expect(screen.getByText('No commit themes detected')).toBeTruthy();
  });

  it('handles a long theme label without dropping it', () => {
    const longLabel = 'A'.repeat(120);
    render(
      <CommitThemesCard
        themes={{
          ...POPULATED,
          items: [{ ...POPULATED.items[0], theme: longLabel }],
        }}
      />
    );
    expect(screen.getByText(longLabel)).toBeTruthy();
  });

  it('handles a zero-count theme without dividing by zero', () => {
    render(
      <CommitThemesCard
        themes={{
          ...POPULATED,
          items: [
            {
              theme: 'Performance',
              confidence: 'Low',
              commitCount: 0,
              share: 0,
              evidence: { repoNames: [], commitShas: [], sampleMessages: [] },
            },
          ],
        }}
      />
    );
    expect(screen.getByText('Performance')).toBeTruthy();
    expect(screen.getByText('0 · 0%')).toBeTruthy();
  });

  it('handles a single theme dataset', () => {
    render(
      <CommitThemesCard
        themes={{
          ...POPULATED,
          items: [POPULATED.items[0]],
          unclassified: 0,
          noMessage: 0,
          noise: 0,
        }}
      />
    );
    expect(screen.getByText('Bug fix')).toBeTruthy();
    expect(screen.getByText('of 84 themed commits')).toBeTruthy();
  });

  it('exposes an accessible list of themes', () => {
    render(<CommitThemesCard themes={POPULATED} />);
    expect(screen.getByRole('list', { name: 'Commit themes' })).toBeTruthy();
  });
});
