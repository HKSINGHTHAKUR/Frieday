import { lazy, Suspense, useEffect, useRef } from 'react';
import { useGitHubAuth } from '../../hooks/useGitHubAuth.js';
import { usePageVisibility } from '../../hooks/usePageVisibility.js';
import { gazeInput } from './robot/gaze.js';
import AuthPanel from './AuthPanel.jsx';
import { BackdropBase, BackdropGlow } from './Backdrop.jsx';
import Header from './Header.jsx';
import OrbitalSystem from './OrbitalSystem.jsx';

const RobotCanvas = lazy(() => import('./robot/RobotCanvas.jsx'));

/**
 * LoginPage — the cinematic GitHub authentication composition.
 *
 * LAYOUT (the desktop no-scroll requirement)
 * --------------------------------------------
 * The root is a flex column of exactly `100dvh`:
 *   - the header is a FIXED-height, `shrink-0` row;
 *   - `<main>` takes the remaining height with `flex: 1; min-height: 0`, so the
 *     composition NEVER exceeds the viewport and the document never scrolls.
 *
 * The grid row is `minmax(0, 1fr)`, so the stage and the card share exactly
 * the leftover height instead of the page growing. The card is centred in that
 * row (`align-self: center`).
 *
 * Below 1024px the composition STACKS (robot above the card) and the page is
 * allowed to scroll vertically, because the content genuinely exceeds a phone
 * viewport. Mobile never has horizontal overflow.
 *
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */
export default function LoginPage() {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const { state, start } = useGitHubAuth();
  const visible = usePageVisibility();

  // While connecting, the robot calmly looks at the GitHub button.
  useEffect(() => {
    if (state.status !== 'redirecting') {
      gazeInput.override = null;
      return undefined;
    }
    const r = document.getElementById('github-cta')?.getBoundingClientRect();
    gazeInput.override = r ? { x: r.left + r.width * 0.3, y: r.top + r.height / 2 } : null;
    return () => {
      gazeInput.override = null;
    };
  }, [state.status]);

  // Pause the decorative CSS animations while the tab is hidden. This is the
  // `data-paused` contract that `styles/login.css` already defines; the
  // attribute is set imperatively so the transition does not cost a render.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (visible) root.removeAttribute('data-paused');
    else root.setAttribute('data-paused', 'true');
    return () => root.removeAttribute('data-paused');
  }, [visible]);

  return (
    <div
      ref={rootRef}
      data-paused={visible ? undefined : 'true'}
      className="fd-auth relative isolate flex h-[100dvh] flex-col overflow-hidden"
    >
      <BackdropBase />
      <Suspense fallback={null}>
        <RobotCanvas containerRef={rootRef} stageRef={stageRef} />
      </Suspense>
      <BackdropGlow />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <Header />
        <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 sm:px-8 desktop:grid desktop:grid-cols-[minmax(0,1fr)_clamp(400px,33vw,484px)] desktop:grid-rows-[minmax(0,1fr)] desktop:gap-[clamp(24px,3vw,56px)] desktop:overflow-visible desktop:px-[clamp(20px,5.5vw,104px)] desktop:pb-[clamp(16px,3svh,40px)]">
          <div
            ref={stageRef}
            className="fd-auth-fade relative -mx-[16px] h-[clamp(230px,34svh,320px)] shrink-0 sm:-mx-[32px] md:h-[420px] desktop:mx-0 desktop:h-auto desktop:min-h-0"
          >
            <OrbitalSystem stageRef={stageRef} />
          </div>
          <div className="relative mx-auto w-full max-w-[484px] desktop:mx-0 desktop:max-w-none desktop:self-center">
            <AuthPanel status={state.status} message={state.message} onStart={start} />
          </div>
        </main>
      </div>
    </div>
  );
}
