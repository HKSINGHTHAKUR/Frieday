/**
 * Button (design_system.md §12). One primary per view; destructive needs confirm.
 * @param {{
 *   variant?: 'primary'|'secondary'|'ghost'|'danger',
 *   size?: 'sm'|'md'|'lg',
 *   loading?: boolean,
 * } & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  ...rest
}) {
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'bg-surface text-text border border-border hover:bg-surface2',
    ghost: 'bg-transparent text-text hover:bg-surface2',
    danger: 'bg-danger text-white hover:brightness-95',
  };
  const sizes = { sm: 'h-28 px-12 text-sm', md: 'h-36 px-16 text-sm', lg: 'h-44 px-24 text-base' };
  return (
    <button
      className={`inline-flex items-center justify-center gap-8 rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="skeleton-pulse inline-block h-16 w-16 rounded-full border-2 border-current"
        />
      )}
      {rest.children}
      {loading && <span className="sr-only">(loading)</span>}
    </button>
  );
}
