/**
 * Toast notification (design_system.md §23). aria-live polite; errors use role alert.
 * Rendering/queueing is owned by the caller in Phase 0 (no global store yet).
 * @param {{ tone?: 'neutral'|'success'|'warning'|'danger'|'info', title: string, onDismiss?: () => void }} props
 */
import { X } from 'lucide-react';

export default function Toast({ tone = 'neutral', title, onDismiss }) {
  const isError = tone === 'danger';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
      className="flex items-center gap-8 rounded-md border border-border bg-surface px-16 py-12 shadow-lg"
    >
      <p className="text-sm text-text">{title}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="ml-auto text-text3"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
