import { Logo } from './Brand.jsx';
import FeatureRow from './FeatureRow.jsx';
import GitHubButton from './GitHubButton.jsx';
import { AlertIcon, InfoIcon } from './icons.jsx';

const HELPER_TEXT = 'New to Frieday? Connecting GitHub is all it takes to get started.';

/**
 * The glass authentication panel: brand, headline, the single GitHub action,
 * a fixed-height status slot, the three benefit rows and the legal line.
 *
 * The status slot is a FIXED height so an error notice never shifts the rest
 * of the card — the layout stays stable whether the status is idle, loading or
 * failed.
 *
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */

/**
 * One fixed-height slot under the button. The helper line and any status
 * notice take turns in it.
 */
function StatusSlot({ status, message, onRetry }) {
  const notice = status === 'error' || status === 'cancelled' || status === 'unavailable';
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="mt-3 flex min-h-[46px] items-center justify-center compact:mt-2.5 compact:min-h-[42px]"
    >
      {status === 'redirecting' && <span className="sr-only">Connecting to GitHub…</span>}
      {!notice && (
        <p className="text-balance text-center text-[13.5px] leading-snug text-[#8a8d93] compact:text-[13px]">
          {HELPER_TEXT}
        </p>
      )}
      {status === 'error' && (
        <div
          role="alert"
          className="flex w-full items-center gap-2.5 rounded-[11px] border border-[rgb(255_106_42/0.35)] bg-[rgb(255_106_42/0.07)] px-3 py-2 text-[13px] leading-snug"
        >
          <AlertIcon className="size-[16px] shrink-0 text-[#ff9b45]" />
          <p className="flex-1 text-[#b6b8bc]">
            {message || 'We couldn’t connect to GitHub. Please try again.'}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-[#ffc078] underline-offset-[3px] hover:underline focus-visible:outline-2 focus-visible:outline-[#ff9b45]"
          >
            Try again
          </button>
        </div>
      )}
      {(status === 'cancelled' || status === 'unavailable') && (
        <div className="flex w-full items-center gap-2.5 rounded-[11px] border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px] leading-snug">
          <InfoIcon className="size-[16px] shrink-0 text-[#8a8d93]" />
          <p className="text-[#b6b8bc]">
            {status === 'cancelled'
              ? 'Authorization was cancelled. Connect whenever you’re ready.'
              : 'GitHub sign-in isn’t configured yet.'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function AuthPanel({ status, message, onStart }) {
  const loading = status === 'redirecting';
  return (
    <section
      aria-labelledby="auth-heading"
      className="fd-auth-glass rounded-[22px] px-5 pb-6 pt-7 sm:px-9 sm:pb-8 sm:pt-9 short:px-8 short:pb-6 short:pt-7 compact:px-7 compact:pb-5 compact:pt-5"
    >
      <div className="hidden justify-center desktop:flex compact:hidden">
        <Logo size="lg" />
      </div>
      <div className="hidden justify-center compact:flex">
        <Logo size="md" />
      </div>

      <h1
        id="auth-heading"
        className="mt-6 text-center text-[27px] font-semibold leading-[1.13] tracking-[-0.025em] text-[#f5f5f5] sm:text-[31px] short:mt-[16px] short:text-[30px] compact:mt-3 compact:text-[27px]"
      >
        Your code has a story.
        <br />
        <span className="fd-auth-warm">Discover it.</span>
      </h1>
      <p className="mx-auto mt-3 max-w-[40ch] text-pretty text-center text-[15px] leading-[1.55] text-[#b6b8bc] short:mt-2.5 compact:mt-2 compact:max-w-[44ch] compact:text-[14.5px] compact:leading-[1.5]">
        Connect your GitHub account to explore your repositories, understand your commit patterns, and
        discover meaningful development insights.
      </p>

      <div className="mt-6 short:mt-5 compact:mt-[16px]">
        <GitHubButton id="github-cta" loading={loading} onClick={onStart} />
      </div>

      <StatusSlot status={status} message={message} onRetry={onStart} />

      <div className="my-5 flex items-center gap-3 short:my-[16px] compact:my-[12px]" aria-hidden="true">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
        <span className="size-1 rotate-45 bg-[#ff6a2a]/70 shadow-[0_0_8px_rgb(255_106_42/0.8)]" />
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
      </div>

      <FeatureRow />

      <p className="mt-6 text-center text-[12.5px] leading-relaxed text-[#8a8d93] short:mt-[16px] compact:mt-[12px] compact:text-[12px] compact:leading-normal">
        By continuing, you agree to our <span className="text-[#b6b8bc]">Terms of Service</span> and{' '}
        <span className="text-[#b6b8bc]">Privacy Policy</span>.
      </p>
    </section>
  );
}
