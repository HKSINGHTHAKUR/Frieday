/**
 * Skeleton placeholder that mirrors final layout (rules.md §19). No layout shift.
 * @param {{ lines?: number, className?: string }} props
 */
export default function Skeleton({ lines = 3, className = '' }) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-8 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-pulse h-16 rounded-sm bg-surface2" />
      ))}
    </div>
  );
}
