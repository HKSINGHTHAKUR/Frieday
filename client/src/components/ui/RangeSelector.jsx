import { memo } from 'react';
import Button from '../ui/Button.jsx';

/**
 * RangeSelector — segmented control for range selection.
 * Controlled via `range` + `onChange` (parent syncs to URL).
 */
export const RangeSelector = memo(function RangeSelector({ range, onChange, className = '' }) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className={`inline-flex items-center rounded-md bg-surface2 p-4 gap-4 ${className}`}
    >
      {['30d', '90d', '12m'].map((value) => (
        <Button
          key={value}
          variant={value === range ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={value === range}
          onClick={() => onChange?.(value)}
        >
          {value}
        </Button>
      ))}
    </div>
  );
});

RangeSelector.displayName = 'RangeSelector';
export default RangeSelector;
