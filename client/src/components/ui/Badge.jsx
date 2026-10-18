/**
 * Badge pill (design_system.md §20). Text is always present — never color-only.
 * @param {{ tone?: 'neutral'|'success'|'warning'|'danger'|'info' } & import('react').HTMLAttributes<HTMLSpanElement>} props
 */
export default function Badge({ tone = 'neutral', children, ...rest }) {
  const tones = {
    neutral: 'bg-surface2 text-text2',
    success: 'bg-successBg text-success',
    warning: 'bg-warningBg text-warning',
    danger: 'bg-dangerBg text-danger',
    info: 'bg-accent-soft text-info',
  };
  return (
    <span
      className={`inline-flex items-center gap-4 rounded-full px-8 py-4 text-xs font-medium ${tones[tone]}`}
      {...rest}
    >
      {children}
    </span>
  );
}
