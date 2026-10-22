import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import LoginPage from './LoginPage.jsx';
import { AuthContext } from '../../store/AuthStore.jsx';

/**
 * The two sign-in controls on the login page.
 *
 * The header's "Sign in" shortcut and the panel's "Continue with GitHub" CTA
 * must be the SAME authentication action: one OAuth initiation, one loading
 * state, one error path, one duplicate-click guard. These tests prove that
 * contract at the component level; the browser run proves it end to end.
 */

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet } from '../../lib/apiClient.js';

const OAUTH_START_URL = '/api/auth/github';

/** Records the router location so a session redirect can be observed. */
function LocationProbe({ onChange }) {
  const location = useLocation();
  onChange(location);
  return null;
}

function renderLogin({ auth = null, entry = '/login', onLocation } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[entry]}>
      {auth ? <AuthContext.Provider value={auth}>{<LoginPage />}</AuthContext.Provider> : <LoginPage />}
      {onLocation ? <LocationProbe onChange={onLocation} /> : null}
    </MemoryRouter>
  );
  return render(tree);
}

/** The authenticated session shape the auth store exposes. */
const AUTHENTICATED = {
  status: 'authenticated',
  user: { githubId: 1, login: 'tester', avatarUrl: '', profileUrl: '', scopes: [] },
  connected: true,
  lastSyncedAt: null,
  error: null,
  logout: vi.fn(),
  disconnect: vi.fn(),
  deleteData: vi.fn(),
  loadMe: vi.fn(),
  refreshSession: vi.fn(),
};

describe('LoginPage — both sign-in controls share one authentication action', () => {
  let replace;

  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue({ ok: true, github: 'configured' });
    // jsdom's `location.replace` is not implemented, and its property is
    // non-configurable — `vi.stubGlobal` is the only reliable way to observe
    // the navigation the OAuth flow starts.
    replace = vi.fn();
    vi.stubGlobal('location', { replace, href: 'http://localhost:5173/login' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts the OAuth flow from the header "Sign in" button', async () => {
    const user = userEvent.setup();
    renderLogin();

    await screen.findByRole('button', { name: 'Continue with GitHub' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(OAUTH_START_URL));
  });

  it('starts the OAuth flow from the "Continue with GitHub" CTA', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Continue with GitHub' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(OAUTH_START_URL));
  });

  it('sends both buttons to the SAME OAuth start route', async () => {
    const user = userEvent.setup();
    const { unmount } = renderLogin();

    await screen.findByRole('button', { name: 'Continue with GitHub' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const fromHeader = replace.mock.calls[0][0];

    unmount();
    cleanup();
    replace.mockClear();

    renderLogin();
    await screen.findByRole('button', { name: 'Continue with GitHub' });
    await user.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const fromCta = replace.mock.calls[0][0];

    expect(fromHeader).toBe(fromCta);
    expect(fromHeader).toBe(OAUTH_START_URL);
  });

  it('starts only ONE OAuth flow when the header button is clicked rapidly', async () => {
    const user = userEvent.setup();
    renderLogin();

    await screen.findByRole('button', { name: 'Continue with GitHub' });
    const signIn = screen.getByRole('button', { name: 'Sign in' });

    await user.click(signIn);
    await user.click(signIn);
    await user.click(signIn);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(OAUTH_START_URL);
  });

  it('starts only ONE OAuth flow when the two buttons are clicked rapidly together', async () => {
    const user = userEvent.setup();
    renderLogin();

    await screen.findByRole('button', { name: 'Continue with GitHub' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    // The CTA's label changes to "Connecting to GitHub…" while busy, so it is
    // addressed by its stable id rather than by its accessible name.
    await user.click(document.getElementById('github-cta'));

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it('puts BOTH buttons into the same busy state while the flow is in flight', async () => {
    const user = userEvent.setup();
    renderLogin();

    await screen.findByRole('button', { name: 'Continue with GitHub' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const cta = await screen.findByRole('button', { name: 'Connecting to GitHub…' });
    expect(cta.getAttribute('aria-busy')).toBe('true');
    expect(cta.getAttribute('aria-disabled')).toBe('true');

    const header = screen.getByRole('button', { name: 'Sign in' });
    expect(header.getAttribute('aria-busy')).toBe('true');
    expect(header.getAttribute('aria-disabled')).toBe('true');
  });

  it('surfaces the backend error and leaves BOTH buttons able to retry the same action', async () => {
    const user = userEvent.setup();
    renderLogin({ entry: '/login?error=exchange_failed' });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn’t complete the GitHub connection/i);

    // The header button retries the identical action.
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(OAUTH_START_URL));
  });

  it('sends an already-authenticated user to the dashboard instead of starting OAuth', async () => {
    const user = userEvent.setup();
    const seen = [];
    renderLogin({ auth: AUTHENTICATED, onLocation: (loc) => seen.push(loc) });

    await screen.findByRole('button', { name: 'Continue with GitHub' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(seen[seen.length - 1].pathname).toBe('/'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps both sign-in controls keyboard reachable with visible focus', async () => {
    const user = userEvent.setup();
    renderLogin();

    await screen.findByRole('button', { name: 'Continue with GitHub' });
    const header = screen.getByRole('button', { name: 'Sign in' });

    expect(header.tagName).toBe('BUTTON');
    expect(header.getAttribute('type')).toBe('button');
    expect(header.getAttribute('aria-disabled')).toBeNull();

    // The header shortcut is the second tab stop (the brand link is first).
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(header);

    // The CTA is reachable by keyboard too.
    const cta = document.getElementById('github-cta');
    cta.focus();
    expect(document.activeElement).toBe(cta);
  });
});
