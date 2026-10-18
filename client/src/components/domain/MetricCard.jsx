import Card from '../ui/Card.jsx';

/**
 * MetricCard — KPI tile: value + period-over-period delta + scope caption.
 */
export default function MetricCard({ title, value, caption, delta }) {
  const deltaColor = delta == null ? 'text-text3' : delta > 0 ? 'text-success' : 'text-text3';
  const deltaDisplay = delta == null ? '—' : delta > 0 ? `+${delta}%` : delta < 0 ? `${delta}%` : '—';

  return (
    <Card title={title}>
      <div className="flex items-baseline justify-between gap-12 mb-4">
        <div>
          <p className="metric text-4xl font-bold text-text mono">{value}</p>
          <p className="mt-4 text-xs text-text3">{title}</p>
        </div>
        <div className="text-right">
          <p className={`metric text-xl font-bold mono ${deltaColor}`}>{deltaDisplay}</p>
          <p className="text-xs text-text3 mt-2">vs prior period</p>
        </div>
      </div>
      <div className="mt-4">{caption}</div>
    </Card>
  );
}
