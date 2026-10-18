import { memo } from 'react';

/**
 * MetricCaption — scope context for any metric display.
 * Usage: <MetricCaption range="30d" scope="authored by you" />
 * Renders: "authored by you · last 30d"
 */
export const MetricCaption = memo(function MetricCaption({
  range = '30d',
  scope = 'authored by you',
  className = '',
}) {
  const rangeLabel =
    {
      '30d': 'last 30 days',
      '90d': 'last 90 days',
      '12m': 'last 12 months',
    }[range] || range;

  return (
    <span className={`text-xs text-text3 ${className}`}>
      {scope} · {rangeLabel}
    </span>
  );
});

export default MetricCaption;
