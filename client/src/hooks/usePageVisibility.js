import { useEffect, useState } from 'react';

/**
 * usePageVisibility — whether the document is currently visible to the user.
 *
 * The `visibilitychange` event is the browser's own signal that a tab is
 * backgrounded. It is deliberately NOT the `blur` event: blurring a window
 * (clicking another application) does not stop the browser from running
 * requestAnimationFrame, whereas a hidden tab does.
 *
 * The value is held in React state so the (rare) transition can be reacted to
 * declaratively; it does NOT change on every animation frame, so it cannot
 * cause a re-render storm.
 *
 * @returns {boolean} true when `document.visibilityState === 'visible'`
 */
export function usePageVisibility() {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState !== 'hidden');
    // The state may have changed between the initial render and this effect.
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return visible;
}

export default usePageVisibility;
