import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LanguageDonut from './LanguageDonut.jsx';

describe('LanguageDonut (prd.md §23 #6: language method + commit share)', () => {
  it('renders empty state when there is no language data', () => {
    render(<LanguageDonut data={{}} />);

    expect(screen.getByText(/No language data/i)).toBeTruthy();
    expect(screen.getByText(/Sync repositories to see language breakdown/i)).toBeTruthy();
  });

  it('renders legend with language, weighted bytes, share of total, and commit share', () => {
    const data = {
      weightedBytes: { TypeScript: 10000, JavaScript: 2000 },
      commitShare: { TypeScript: 0.8, JavaScript: 0.2 },
      totalBytes: 12000,
    };
    render(<LanguageDonut data={data} />);

    expect(screen.getByText('TypeScript')).toBeTruthy();
    expect(screen.getByText('JavaScript')).toBeTruthy();
    expect(screen.getByText(/9\.8 KB/)).toBeTruthy();
    expect(screen.getByText(/2\.0 KB/)).toBeTruthy();
    expect(screen.getByText(/83\.3%/)).toBeTruthy();
    expect(screen.getByText(/16\.7%/)).toBeTruthy();
    // commitShare is a COMMIT COUNT, never a percentage.
    expect(screen.getByText(/0\.8 commits/)).toBeTruthy();
    expect(screen.getByText(/0\.2 commits/)).toBeTruthy();
  });

  it('shows every language in the legend with commit share (no in-pie label overflow)', () => {
    const data = {
      weightedBytes: { TypeScript: 9000, JavaScript: 2000, Dockerfile: 500 },
      commitShare: { TypeScript: 0.8, JavaScript: 0.2, Dockerfile: 0.05 },
      totalBytes: 11500,
    };
    render(<LanguageDonut data={data} />);

    expect(screen.getByText('TypeScript')).toBeTruthy();
    expect(screen.getByText('JavaScript')).toBeTruthy();
    expect(screen.getByText('Dockerfile')).toBeTruthy();
    expect(screen.getByText(/8\.8 KB/)).toBeTruthy();
    expect(screen.getByText(/78\.3%/)).toBeTruthy();
    expect(screen.getByText(/0\.8 commits/)).toBeTruthy();
    expect(screen.getAllByText(/commits/).length).toBeGreaterThan(0);
  });

  it('never renders commit share as a percentage (a share cannot exceed 100%)', () => {
    // Production regression: backend commitShare is a commit COUNT, so a
    // repo with many commits produced values like 216.8 — which was
    // rendered as "commit share 216.8%".
    const data = {
      weightedBytes: { Java: 466100, JavaScript: 1585909 },
      commitShare: { Java: 216.83, JavaScript: 11.46 },
      totalBytes: 2052009,
    };
    render(<LanguageDonut data={data} />);

    // Rendered as a commit count...
    expect(screen.getByText(/216\.8 commits/)).toBeTruthy();
    expect(screen.getByText(/11\.5 commits/)).toBeTruthy();
    // ...and never with a percent sign.
    expect(screen.queryByText(/216\.8%/)).toBeNull();
    expect(screen.queryByText(/11\.5%/)).toBeNull();
  });
});
