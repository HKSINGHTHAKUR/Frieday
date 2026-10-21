/**
 * Shared placement of the robot head inside its stage.
 *
 * Both the WebGL scene and the orbital overlay use this, so the callouts stay
 * attached to the head. Ported from the supplied "Frieday GitHub Authentication
 * Design" export.
 *
 * @typedef {{ cx: number, cy: number, size: number }} RobotLayout
 */

/**
 * @param {number} width stage width in pixels
 * @param {number} height stage height in pixels
 * @param {boolean} stacked whether the stacked (tablet/mobile) composition applies
 * @returns {RobotLayout}
 */
export function computeRobotLayout(width, height, stacked) {
  if (stacked) {
    return {
      cx: width * 0.5,
      cy: height * 0.5,
      size: Math.min(height * 0.52, width * 0.6),
    };
  }
  return {
    cx: width * 0.55,
    cy: height * 0.47,
    size: Math.min(height * 0.45, width * 0.52),
  };
}

/** Below this width the composition stacks the robot above the panel. */
export const STACKED_BREAKPOINT = 1024;

export function isStacked() {
  return !window.matchMedia(`(min-width: ${STACKED_BREAKPOINT}px)`).matches;
}
