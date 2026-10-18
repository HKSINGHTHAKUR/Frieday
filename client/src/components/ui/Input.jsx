/**
 * Text input with label + error (design_system.md §13). No placeholder-as-label.
 * @param {{ label: string, error?: string, id: string } & import('react').InputHTMLAttributes<HTMLInputElement>} props
 */
export default function Input({ label, error, id, ...rest }) {
  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`h-36 rounded-sm border bg-surface px-12 text-sm text-text ${
          error ? 'border-danger' : 'border-borderStrong'
        }`}
        {...rest}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
