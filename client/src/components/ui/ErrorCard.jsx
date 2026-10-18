import { useState } from 'react';
import Button from './Button.jsx';

/**
 * Inline error card with retry + details expander (request ID, no stack).
 * @param {{ title: string, message: string, requestId?: string, onRetry?: () => void }} props
 */
export default function ErrorCard({ title, message, requestId, onRetry }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div role="alert" className="flex flex-col gap-8 rounded-md border border-danger bg-dangerBg p-20">
      <h2 className="text-base font-semibold text-danger">{title}</h2>
      <p className="text-sm text-text2">{message}</p>
      <div className="flex items-center gap-8">
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
        {requestId && (
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="text-xs font-medium text-text3 underline"
          >
            Details
          </button>
        )}
      </div>
      {showDetails && requestId && <p className="mono text-xs text-text3">Request ID: {requestId}</p>}
    </div>
  );
}
