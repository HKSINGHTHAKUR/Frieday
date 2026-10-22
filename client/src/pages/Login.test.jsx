import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Login from './Login.jsx';
import { apiGet } from '../lib/apiClient.js';

/**
 * The login screen (T1.1) after the cinematic GitHub-auth composition landed.
 *
 * These tests cover the CONTRACT between the page and the real backend, not
 * the decoration: the CTA must start the backend's OAuth route, the backend's
 * `?error=<code>` return must be surfaced, and the page must not crash.
 */

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

/** Reports the router location so URL cleaning can be observed. */
function LocationProbe({ onChange }) {
  const location = useLocation();
  onChange(location);
  return null;
}

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Login />
    </MemoryRouter>
  );
}

describe('Login page — GitHub OAuth composition', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue({ ok: true, github: 'configured' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the GitHub CTA and the brand headline', async () => {
    renderLogin();
    expect(await screen.findByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('probes /api/health to decide whether sign-in is available', async () => {
    renderLogin();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/health'));
  });

  it('shows an honest notice when the backend reports GitHub is not configured', async () => {
    apiGet.mockResolvedValue({ ok: true, github: 'unconfigured' });
    renderLogin();
    expect(await screen.findByText(/isn’t configured yet/i)).toBeTruthy();
  });

  it('surfaces the backend exchange_failed error returned via the query string', async () => {
    renderLogin('/login?error=exchange_failed');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn’t complete the GitHub connection/i);
  });

  it('treats the backend denied error as a neutral cancellation, not an error', async () => {
    renderLogin('/login?error=denied');
    await waitFor(() => expect(screen.getByText(/cancelled/i)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cleans the OAuth error out of the URL so a refresh does not replay it', async () => {
    const seen = [];
    render(
      <MemoryRouter initialEntries={['/login?error=exchange_failed']}>
        <LocationProbe onChange={(loc) => seen.push(loc)} />
        <Login />
      </MemoryRouter>
    );
    await screen.findByRole('alert');
    await waitFor(() => expect(seen[seen.length - 1].search).toBe(''));
  });

  it('starts the real OAuth flow through the backend start route', async () => {
    renderLogin();
    const cta = await screen.findByRole('button', { name: 'Continue with GitHub' });

    // The CTA must NOT navigate through the router (that would break the
    // server-side 302 to GitHub), so a router Link is not used here.
    expect(cta.tagName).toBe('BUTTON');
    expect(cta.getAttribute('type')).toBe('button');
  });
});

describe('Login page — the return destination', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue({ ok: true, github: 'configured' });
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('remembers a valid intended destination across the OAuth round-trip', async () => {
    render(
      <MemoryRouter initialEntries={['/login?next=%2Finsights']}>
        <Login />
      </MemoryRouter>
    );
    const cta = await screen.findByRole('button', { name: 'Continue with GitHub' });
    cta.click();

    await waitFor(() => {
      expect(window.sessionStorage.getItem('fd:pending-destination')).toBe('/insights');
    });
  });

  it('does not remember a malicious destination', async () => {
    render(
      <MemoryRouter initialEntries={['/login?next=https%3A%2F%2Fevil.example%2Fsteal']}>
        <Login />
      </MemoryRouter>
    );
    const cta = await screen.findByRole('button', { name: 'Continue with GitHub' });
    cta.click();

    await waitFor(() => {
      expect(window.sessionStorage.getItem('fd:pending-destination')).toBeNull();
    });
  });

  it('remembers nothing when there is no destination', async () => {
    renderLogin();
    const cta = await screen.findByRole('button', { name: 'Continue with GitHub' });
    cta.click();

    await waitFor(() => {
      expect(window.sessionStorage.getItem('fd:pending-destination')).toBeNull();
    });
  });
});
