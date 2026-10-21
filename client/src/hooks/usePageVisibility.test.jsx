import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { usePageVisibility } from './usePageVisibility.js';

/**
 * The tab-visibility signal that drives the login screen's animation
 * lifecycle. The robot's render loop and the decorative CSS animations must
 * both stop while the tab is hidden and resume when it becomes visible.
 */

/** Overrides `document.visibilityState` and fires `visibilitychange`. */
function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function Probe() {
  const visible = usePageVisibility();
  return <span data-testid="state">{visible ? 'visible' : 'hidden'}</span>;
}

describe('usePageVisibility', () => {
  let originalDescriptor;

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalDescriptor);
    } else {
      delete document.visibilityState;
    }
  });

  it('reports visible on a visible document', () => {
    setVisibility('visible');
    render(<Probe />);
    expect(screen.getByTestId('state').textContent).toBe('visible');
  });

  it('reports hidden once the tab is hidden', async () => {
    setVisibility('visible');
    render(<Probe />);
    setVisibility('hidden');
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('hidden'));
  });

  it('reports visible again when the tab is restored', async () => {
    setVisibility('visible');
    render(<Probe />);
    setVisibility('hidden');
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('hidden'));
    setVisibility('visible');
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('visible'));
  });

  it('handles repeated visibility changes without leaking listeners', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Probe />);
    const added = add.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(added).toHaveLength(1);
    unmount();
    const removed = remove.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(removed).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it('does not re-render on unrelated updates', async () => {
    let renders = 0;
    function Counter() {
      renders += 1;
      usePageVisibility();
      return null;
    }
    render(<Counter />);
    const before = renders;
    setVisibility('hidden');
    await waitFor(() => expect(screen.queryByTestId('state')).toBeNull());
    // Exactly one extra render for the single visibility transition.
    expect(renders).toBe(before + 1);
  });
});
