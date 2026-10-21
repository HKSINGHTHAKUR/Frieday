/**
 * Robot gaze input — pointer state shared with the render loop.
 *
 * The pointer is tracked in a MUTABLE module object, never in React state, so
 * pointer movement never triggers a re-render of the page. The render loop
 * reads this object once per frame.
 *
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */

/**
 * @typedef {{ x: number, y: number, active: boolean, touch: boolean, override: {x:number,y:number}|null }} GazeInput
 */

/** @type {GazeInput} */
export const gazeInput = {
  x: 0,
  y: 0,
  active: false,
  touch: false,
  /** Optional fixed point to look at (e.g. the GitHub button while connecting). */
  override: null,
};

let attached = 0;
let touchTimer;

function onMove(event) {
  gazeInput.x = event.clientX;
  gazeInput.y = event.clientY;
  gazeInput.touch = event.pointerType === 'touch';
  gazeInput.active = true;
  if (gazeInput.touch) {
    window.clearTimeout(touchTimer);
    // On touch the pointer stops being tracked, so the head returns to rest
    // after a moment instead of staring at the last touch point.
    touchTimer = window.setTimeout(() => {
      gazeInput.active = false;
    }, 1600);
  }
}

function onLeave(event) {
  if (!event.relatedTarget) gazeInput.active = false;
}

function onBlur() {
  gazeInput.active = false;
}

/**
 * Attach the shared pointer listeners. Reference-counted so multiple callers
 * (and React StrictMode double-invocation) cannot add duplicate listeners.
 * @returns {() => void} detach function
 */
export function attachGazeListeners() {
  if (attached === 0) {
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('pointerout', onLeave, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave, { passive: true });
    window.addEventListener('blur', onBlur);
  }
  attached += 1;
  return () => {
    attached -= 1;
    if (attached === 0) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('pointerout', onLeave);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onBlur);
    }
  };
}
