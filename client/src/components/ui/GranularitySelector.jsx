import { memo } from 'react';
import Button from '../ui/Button.jsx';

/**
 * GranularitySelector — segmented control for timeline granularity.
 * Controlled via `granularity` + `onChange` (parent syncs to URL).
 */
export const GranularitySelector = memo(function GranularitySelector({
  granularity,
  onChange,
  className = '',
}) {
  return (
    <div
      role="group"
      aria-label="Granularity"
      className={`inline-flex items-center rounded-md bg-surface2 p-4 gap-4 ${className}`}
    >
      {['day', 'week'].map((value) => (
        <Button
          key={value}
          variant={value === granularity ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={value === granularity}
          onClick={() => onChange?.(value)}
        >
          {value === 'day' ? 'Day' : 'Week'}
        </Button>
      ))}
    </div>
  );
});

GranularitySelector.displayName = 'GranularitySelector';
export default GranularitySelector;
