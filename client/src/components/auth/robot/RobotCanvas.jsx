import { useEffect, useRef, useState } from 'react';
import { usePageVisibility } from '../../../hooks/usePageVisibility.js';
import { useReducedMotion } from '../../../hooks/useReducedMotion.js';
import { attachGazeListeners } from './gaze.js';
import { computeRobotLayout, isStacked } from './layout.js';

/**
 * RobotCanvas — the WebGL robot, its placement, and its pointer tracking.
 *
 * The scene module is imported DYNAMICALLY so Three.js is only fetched when
 * the auth page actually renders (it is ~600 KB of the bundle otherwise).
 *
 * LIFECYCLE
 * ---------
 * The render loop runs only while ALL of these hold:
 *   - the tab is visible (`usePageVisibility`);
 *   - the canvas is on screen (`IntersectionObserver`);
 *   - the user did not ask for reduced motion (`useReducedMotion`).
 *
 * When any of them stops holding, the loop is STOPPED (not disposed) — the
 * scene, its GPU resources and the spring state all survive, so resuming is
 * seamless and the head does not jump.
 *
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */
export default function RobotCanvas({ containerRef, stageRef }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const reducedMotion = useReducedMotion();
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const pageVisible = usePageVisibility();
  const pageVisibleRef = useRef(pageVisible);
  pageVisibleRef.current = pageVisible;
  // The one function that decides whether the render loop runs. It is shared
  // with the mount effect (which owns the `inView` signal) so there is a
  // single decision point and never two competing loops.
  const syncRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!canvas || !container || !stage) return undefined;

    let disposed = false;
    let scene = null;
    const cleanups = [attachGazeListeners()];

    const measure = () => {
      if (!scene) return;
      const c = container.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      if (c.width < 2 || c.height < 2) return;
      const layout = computeRobotLayout(s.width, s.height, isStacked());
      scene.setPlacement({
        width: c.width,
        height: c.height,
        ax: s.left - c.left + layout.cx,
        ay: s.top - c.top + layout.cy,
        size: layout.size,
      });
    };

    // Whether the canvas is currently within the viewport.
    let inView = true;
    /**
     * The single place that decides whether the render loop runs. Every
     * signal that can change it calls this, so there is exactly one loop and
     * never two.
     */
    const sync = () => {
      if (!scene) return;
      if (inView && pageVisibleRef.current && !reducedRef.current) {
        scene.start();
      } else {
        scene.stop();
      }
    };
    syncRef.current = sync;

    import('./RobotScene.js')
      .then(({ RobotScene }) => {
        if (disposed) return;
        try {
          scene = new RobotScene(canvas, { reducedMotion: reducedRef.current });
        } catch {
          // WebGL unavailable (or blocked) — the CSS backdrop remains, so the
          // page still looks right and the GitHub button still works.
          setFailed(true);
          return;
        }
        sceneRef.current = scene;
        scene.onReady = () => setReady(true);
        measure();
        sync();

        const ro = new ResizeObserver(measure);
        ro.observe(container);
        ro.observe(stage);
        const io = new IntersectionObserver(([entry]) => {
          inView = entry.isIntersecting;
          sync();
        });
        io.observe(canvas);
        const onLost = (e) => {
          e.preventDefault();
          setFailed(true);
        };
        canvas.addEventListener('webglcontextlost', onLost);
        cleanups.push(
          () => ro.disconnect(),
          () => io.disconnect(),
          () => canvas.removeEventListener('webglcontextlost', onLost)
        );
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      syncRef.current = null;
      cleanups.forEach((fn) => fn());
      if (scene) scene.dispose();
      sceneRef.current = null;
    };
  }, [containerRef, stageRef]);

  // Reduced motion and tab visibility are handled OUTSIDE the mount effect so
  // they can change without rebuilding the scene. `setReducedMotion` also
  // snaps the head to its static neutral pose; visibility must NOT, so the
  // pose is preserved across a tab switch.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setReducedMotion(reducedMotion);
    syncRef.current?.();
  }, [reducedMotion, pageVisible]);

  if (failed) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 block h-full w-full transition-opacity duration-[1400ms]"
      style={{ opacity: ready ? 1 : 0 }}
    />
  );
}
