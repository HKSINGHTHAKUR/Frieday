import Card from '../ui/Card.jsx';

/**
 * MetricCard — KPI tile: value + period-over-period delta + scope caption.
 */
export default function MetricCard({ title, value, caption, delta }) {
  const deltaColor = delta == null ? 'text-text3' : delta > 0 ? 'text-success' : 'text-text3';
  const deltaDisplay = delta == null ? '—' : delta > 0 ? `+${delta}%` : delta < 0 ? `${delta}%` : '—';

  return (
    <Card title={title}>
      {/* Wraps instead of overflowing: at 320px the KPI column is ~94px wide
          and the value + delta side-by-side need ~138px. The delta drops to
          its own line (right-aligned) rather than clipping the card.
          design_system.md §27: no unintended horizontal overflow. */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-12 gap-y-4">
        <div className="min-w-0">
          <p className="metric text-4xl font-bold text-text mono">{value}</p>
          <p className="mt-4 text-xs text-text3">{title}</p>
        </div>
        <div className="ml-auto shrink-0 text-right">
          <p className={`metric text-xl font-bold mono ${deltaColor}`}>{deltaDisplay}</p>
          <p className="mt-2 text-xs text-text3">vs prior period</p>
        </div>
      </div>
      <div className="mt-4">{caption}</div>
    </Card>
  );
}
