import { forwardRef } from 'react';
import { ChevronRight, GitHubMark, Spinner } from './icons.jsx';

/**
 * GitHubButton — the single white GitHub authentication action.
 *
 * `aria-disabled` (rather than `disabled`) is used while loading so the button
 * keeps keyboard focus and the focus ring is never clipped.
 *
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */
const GitHubButton = forwardRef(function GitHubButton(
  { id, loading = false, disabled = false, onClick },
  ref
) {
  const blocked = loading || disabled;

  return (
    <button
      ref={ref}
      id={id}
      type="button"
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      onClick={() => !blocked && onClick?.()}
      className={[
        'group relative flex h-[56px] w-full select-none items-center gap-[16px] rounded-[13px] px-5 text-left',
        'sm:h-[62px] desktop:h-[64px] short:h-[58px] compact:h-[56px]',
        'bg-[#f3f3f4] text-[#0b0c0e] text-[16px] font-semibold tracking-[-0.01em]',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.9),0_14px_34px_-16px_rgb(0_0_0/0.9)]',
        'transition-[background-color,box-shadow,transform,opacity] duration-200',
        'outline-none focus-visible:ring-2 focus-visible:ring-[#ff9b45] focus-visible:ring-offset-[3px] focus-visible:ring-offset-[#101214]',
        blocked
          ? 'cursor-default'
          : 'cursor-pointer hover:-translate-y-px hover:bg-white hover:shadow-[inset_0_1px_0_#fff,0_18px_40px_-14px_rgb(255_120_60/0.45),0_0_0_1px_rgb(255_180_120/0.35)] active:translate-y-0 active:scale-[0.995] active:bg-[#e7e7e9]',
      ].join(' ')}
    >
      <GitHubMark className="size-[26px] shrink-0" />
      <span className="flex-1" aria-live="off">
        {loading ? 'Connecting to GitHub…' : 'Continue with GitHub'}
      </span>
      <span className="grid size-6 place-items-center text-[#2b2d31]">
        {loading ? (
          <Spinner className="size-[18px] text-[#ff6a2a]" />
        ) : (
          <ChevronRight className="size-[18px] transition-transform duration-200 group-hover:translate-x-[3px]" />
        )}
      </span>
    </button>
  );
});

export default GitHubButton;
