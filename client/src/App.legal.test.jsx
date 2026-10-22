import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Terms from './pages/Terms.jsx';
import Privacy from './pages/Privacy.jsx';
import GitHubData from './pages/GitHubData.jsx';
import { apiGet, apiPost } from './lib/apiClient.js';

vi.mock('./lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  setSessionRefresher: vi.fn(),
}));

const routes = [
  { path: '/terms', Component: Terms, title: 'Terms of Service' },
  { path: '/privacy', Component: Privacy, title: 'Privacy Policy' },
  { path: '/github-data', Component: GitHubData, title: 'GitHub Data & Permissions' },
];

function renderPage(Component, initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Component />
    </MemoryRouter>
  );
}

describe('Legal pages — public access without authentication', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(routes)('renders $title at $path without authentication', ({ path, Component, title }) => {
    renderPage(Component, [path]);
    expect(screen.getByRole('heading', { name: title, level: 1 })).toBeTruthy();
    // No sign-in CTA should appear on a public legal page.
    expect(screen.queryByRole('button', { name: /continue with github/i })).toBeNull();
  });

  it.each(routes)('renders on direct load (simulated refresh) at $path', ({ path, Component }) => {
    renderPage(Component, [path]);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it.each(routes)('does not initiate OAuth at $path', async ({ path, Component }) => {
    renderPage(Component, [path]);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    expect(apiGet).not.toHaveBeenCalledWith('/api/auth/github');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it.each(routes)('does not expose private GitHub user data at $path', ({ path, Component }) => {
    renderPage(Component, [path]);
    // No GitHub avatar image or external github.com profile link should be rendered.
    expect(screen.queryByRole('img', { name: /avatar/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /tester|login|profile/i })).toBeNull();
  });

  it.each(routes)('links to home and the other legal pages at $path', ({ path, Component }) => {
    renderPage(Component, [path]);
    expect(screen.getByRole('link', { name: /frieday/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /sign in/i })).toBeTruthy();
  });
});

describe('Legal pages — accessibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(routes)('uses semantic heading and light-theme tokens at $path', ({ path, Component }) => {
    renderPage(Component, [path]);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).toContain('text-text');
    // Light design tokens are applied via Tailwind classes (design_system.md §4).
    const main = screen.getByRole('main');
    expect(main.className).toContain('bg-bg');
    expect(main.className).toContain('text-text');
  });
});
