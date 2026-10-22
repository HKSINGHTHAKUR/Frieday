import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useGitHubAuth } from '../../hooks/useGitHubAuth.js';
import { useAuth } from '../../hooks/useAuth.js';
import { usePageVisibility } from '../../hooks/usePageVisibility.js';
import { safeNavigate } from '../../lib/safeNavigate.js';
import { readReturnDestination, setPendingDestination } from '../../lib/returnDestination.js';
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
  const { status: sessionStatus } = useAuth();
  const navigate = useNavigate();
  const visible = usePageVisibility();
  const [searchParams] = useSearchParams();

  // Where the user was heading before they were sent to the login page. It
  // arrives as `?next=<route>` and is validated before it is used, so a
  // crafted link cannot turn the sign-in into an open redirect.
  const destination = useMemo(() => readReturnDestination(`?${searchParams.toString()}`), [searchParams]);

  // THE sign-in action. Both the header's "Sign in" shortcut and the panel's
  // "Continue with GitHub" CTA call this, so they share one OAuth initiation,
  // one loading/disabled state, one error path and one duplicate-click guard
  // (the `starting` ref inside useGitHubAuth).
  //
  // Session policy: a user who already has a valid session is sent to the
  // dashboard instead of starting a redundant OAuth flow. (The app's auth
  // gate normally bounces them off /login before this renders; this keeps the
  // behaviour correct for the moment the session is known but the gate has
  // not re-rendered yet.)
  const signIn = useCallback(() => {
    // Remember the intended destination across the OAuth round-trip. The
    // flow is a full page navigation, so the `?next=` parameter is lost on
    // the way out to the provider.
    setPendingDestination(destination);
    if (sessionStatus === 'authenticated') {
      safeNavigate(navigate, destination, { replace: true });
      return;
    }
    start();
  }, [destination, navigate, sessionStatus, start]);

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

  const busy = state.status === 'redirecting';

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
        <Header onSignIn={signIn} busy={busy} />
        <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 sm:px-8 desktop:grid desktop:grid-cols-[minmax(0,1fr)_clamp(400px,33vw,484px)] desktop:grid-rows-[minmax(0,1fr)] desktop:gap-[clamp(24px,3vw,56px)] desktop:overflow-visible desktop:px-[clamp(20px,5.5vw,104px)] desktop:pb-[clamp(16px,3svh,40px)]">
          <div
            ref={stageRef}
            className="fd-auth-fade relative -mx-[16px] h-[clamp(230px,34svh,320px)] shrink-0 sm:-mx-[32px] md:h-[420px] desktop:mx-0 desktop:h-auto desktop:min-h-0"
          >
            <OrbitalSystem stageRef={stageRef} />
          </div>
          <div className="relative mx-auto w-full max-w-[484px] desktop:mx-0 desktop:max-w-none desktop:self-center">
            <AuthPanel status={state.status} message={state.message} onStart={signIn} />
            <div className="mt-24 flex flex-col gap-[8px] items-center text-center sm:flex-row sm:justify-between sm:text-left">
              <Link
                to="/terms"
                className="text-xs text-[#8a8d93] hover:text-[#f5f5f5] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9b45]"
              >
                Terms of Service
              </Link>
              <Link
                to="/privacy"
                className="text-xs text-[#8a8d93] hover:text-[#f5f5f5] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9b45]"
              >
                Privacy Policy
              </Link>
              <Link
                to="/github-data"
                className="text-xs text-[#8a8d93] hover:text-[#f5f5f5] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9b45]"
              >
                GitHub Data &amp; Permissions
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
