import Button from './Button.jsx';

/**
 * Empty state: cause + next action, never shame (design_system.md §25).
 * @param {{ title: string, body: string, actionLabel?: string, onAction?: () => void }} props
 */
export default function EmptyState({ title, body, actionLabel, onAction }) {
  return (
    <div className="flex flex-col items-center gap-8 rounded-lg border border-border bg-surface p-32 text-center">
      <div aria-hidden="true" className="h-40 w-40 rounded-lg bg-surface2" />
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="max-w-narrow text-sm text-text2">{body}</p>
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
