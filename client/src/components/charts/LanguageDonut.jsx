import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { memo } from 'react';

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;

  const entry = payload[0];
  const { name, value } = entry;
  const total = entry.payload?.total || 0;
  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
  const commitShare =
    entry.payload?.commitShare !== undefined ? `${entry.payload.commitShare.toFixed(1)}%` : '—';

  const formatBytes = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  return (
    <div className="bg-surface border border-border rounded-md p-8 shadow-lg min-w-[220px]">
      <p className="font-medium text-text mb-2">{name}</p>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-text3">Weighted bytes</span>
          <span className="font-mono font-medium text-text">{formatBytes(value)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text3">Share of total</span>
          <span className="font-mono font-medium text-text">{percentage}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text3">Commit share</span>
          <span className="font-mono font-medium text-text">{commitShare}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * CustomLegend — renders language legend below the donut so long language
 * names never overflow or collide with chart slices (design_system.md §17:
 * "legend with bytes + % + commit share").
 *
 * The legend lives OUTSIDE the fixed-height chart box (design_system.md §27,
 * and the same pattern ActivityChart uses): a fixed height on the wrapper that
 * also contains the legend clips/overlaps the legend onto the next card.
 */
function CustomLegend({ payload }) {
  const total = payload.reduce((sum, { value }) => sum + value, 0);
  if (payload.length === 0) return null;
  return (
    <div className="mt-12 flex flex-col gap-8" role="list" aria-label="Language legend">
      {payload.map((entry, index) => {
        const color = COLORS[index % COLORS.length];
        const { name, value, commitShare } = entry;
        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
        const commitShareDisplay = commitShare !== undefined ? `${commitShare.toFixed(1)}%` : '—';
        const formatBytes = (bytes) => {
          if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
          if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
          return `${bytes} B`;
        };
        return (
          <div key={name} role="listitem" className="flex min-w-0 items-start gap-8">
            <span
              className="mt-4 h-2 w-12 shrink-0 rounded"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-8 gap-y-2">
              <span className="min-w-0 break-words text-sm text-text">{name}</span>
              <span className="mono shrink-0 text-xs text-text2">
                {formatBytes(value)} · {percentage}% · commit share {commitShareDisplay}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const LanguageDonut = memo(function LanguageDonut({ data }) {
  // data: { weightedBytes: { TypeScript: 1000, JavaScript: 500 }, commitShare: { ... } }
  // We use weightedBytes for the donut visualization
  const weightedBytes = data?.weightedBytes || {};

  const total = Object.values(weightedBytes).reduce((a, b) => a + b, 0);

  if (!total) {
    return (
      <div className="flex w-full items-center justify-center rounded-md border border-border bg-surface">
        <div className="p-16 text-center text-text3">
          <p className="font-medium text-text">No language data</p>
          <p className="mt-4 text-sm text-text3">Sync repositories to see language breakdown.</p>
        </div>
      </div>
    );
  }

  const pieData = Object.entries(data.weightedBytes).map(([name, value]) => ({
    name,
    value,
    total: data.totalBytes || Object.values(data.weightedBytes).reduce((a, b) => a + b, 0),
    commitShare: data.commitShare?.[name],
  }));

  // Limit to top 5 + Other
  const sorted = [...pieData].sort((a, b) => b.value - a.value);
  const top5 = sorted.slice(0, 5);
  const otherValue = pieData.length > 5 ? pieData.slice(5).reduce((sum, d) => sum + d.value, 0) : 0;
  const dataForChart = otherValue > 0 ? [...top5, { name: 'Other', value: otherValue }] : top5;

  return (
    <div className="w-full" role="img" aria-label="Language breakdown donut chart">
      {/* Fixed height applies to the chart box ONLY — the legend below is a
          sibling so it can never be clipped or overlap the next card. */}
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={dataForChart}
              cx="50%"
              cy="50%"
              innerRadius="45%"
              outerRadius="78%"
              paddingAngle={2}
              dataKey="value"
              nameKey="name"
              labelLine={false}
            >
              {dataForChart.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <CustomLegend payload={dataForChart} />
    </div>
  );
});

export default LanguageDonut;
