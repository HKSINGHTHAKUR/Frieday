import { Logo } from './Brand.jsx';

/**
 * Focus the primary GitHub action and bring it into view.
 *
 * Uses the element's own box so the CTA is always reachable, even if the
 * composition has been scrolled on a short window.
 */
export function focusPrimaryAction() {
  const cta = document.getElementById('github-cta');
  if (!cta) return;
  const rect = cta.getBoundingClientRect();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    cta.scrollIntoView({
      block: 'center',
      behavior: reduced ? 'auto' : 'smooth',
    });
  }
  cta.focus({ preventScroll: true });
  cta.dataset.attention = 'true';
  window.setTimeout(() => delete cta.dataset.attention, 1400);
}

/**
 * The auth-page header: brand on the left, the sign-in shortcut on the right.
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */
export default function Header() {
  return (
    <header className="relative z-20 flex h-[64px] shrink-0 items-center justify-between px-5 sm:px-8 desktop:h-[84px] desktop:px-[clamp(20px,5.5vw,104px)] short:h-[72px] compact:h-[64px]">
      <a
        href="/"
        aria-label="Frieday home"
        className="-m-2 rounded-lg p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9b45]"
      >
        <Logo size="md" />
      </a>

      <button
        type="button"
        onClick={focusPrimaryAction}
        className="h-10 rounded-[11px] border border-[rgb(255_140_80/0.42)] bg-[linear-gradient(180deg,rgb(255_120_60/0.08),rgb(255_120_60/0.02))] px-5 text-[14.5px] font-medium text-[#f5f5f5] shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_0_24px_-10px_rgb(255_106_42/0.6)] transition-[border-color,background-color,box-shadow] duration-200 hover:border-[rgb(255_155_69/0.75)] hover:bg-[rgb(255_120_60/0.1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9b45]"
      >
        Sign in
      </button>
    </header>
  );
}
