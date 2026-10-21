import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(callback) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

/**
 * Whether the user asked for reduced motion.
 *
 * `useSyncExternalStore` so the media-query state is read without an effect
 * and without re-rendering on unrelated parent updates.
 * @returns {boolean}
 */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}

export default useReducedMotion;
