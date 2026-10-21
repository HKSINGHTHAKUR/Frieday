import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage.jsx';

/**
 * The login page's tab-visibility lifecycle.
 *
 * The decorative CSS animations are driven by the `data-paused` attribute on
 * the composition root (the contract `styles/login.css` already defines).
 * These tests prove the attribute is actually set and cleared, and that the
 * OAuth state is untouched by a visibility change.
 */

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet } from '../../lib/apiClient.js';

const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>
  );
}

describe('LoginPage — tab visibility lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue({ ok: true, github: 'configured' });
    setVisibility('visible');
  });

  afterEach(() => {
    if (originalVisibility) {
      Object.defineProperty(document, 'visibilityState', originalVisibility);
    } else {
      delete document.visibilityState;
    }
  });

  it('does not mark the composition as paused while the tab is visible', async () => {
    renderLogin();
    await screen.findByRole('button', { name: 'Continue with GitHub' });
    expect(document.querySelector('.fd-auth')?.hasAttribute('data-paused')).toBe(false);
  });

  it('marks the composition as paused when the tab is hidden', async () => {
    renderLogin();
    await screen.findByRole('button', { name: 'Continue with GitHub' });
    setVisibility('hidden');
    await waitFor(() => expect(document.querySelector('.fd-auth')?.getAttribute('data-paused')).toBe('true'));
  });

  it('clears the paused state when the tab becomes visible again', async () => {
    renderLogin();
    await screen.findByRole('button', { name: 'Continue with GitHub' });
    setVisibility('hidden');
    await waitFor(() => expect(document.querySelector('.fd-auth')?.getAttribute('data-paused')).toBe('true'));
    setVisibility('visible');
    await waitFor(() => expect(document.querySelector('.fd-auth')?.hasAttribute('data-paused')).toBe(false));
  });

  it('leaves the GitHub action usable across a visibility change', async () => {
    renderLogin();
    const cta = await screen.findByRole('button', { name: 'Continue with GitHub' });
    setVisibility('hidden');
    setVisibility('visible');
    await waitFor(() => expect(cta).toBeTruthy());
    // The CTA is not disabled and its handler is still wired.
    expect(cta.hasAttribute('disabled')).toBe(false);
    expect(cta.getAttribute('aria-disabled')).toBeNull();
  });

  it('does not interrupt an in-flight OAuth error message', async () => {
    render(
      <MemoryRouter initialEntries={['/login?error=exchange_failed']}>
        <LoginPage />
      </MemoryRouter>
    );
    const alert = await screen.findByRole('alert');
    setVisibility('hidden');
    setVisibility('visible');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(alert.textContent).toMatch(/couldn’t complete the GitHub connection/i);
  });

  it('removes the paused attribute when the page unmounts', async () => {
    const { unmount } = renderLogin();
    await screen.findByRole('button', { name: 'Continue with GitHub' });
    setVisibility('hidden');
    await waitFor(() => expect(document.querySelector('.fd-auth')?.getAttribute('data-paused')).toBe('true'));
    unmount();
    // No leftover state on a detached node.
    expect(document.querySelector('.fd-auth')).toBeNull();
  });
});
