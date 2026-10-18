import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { memo } from 'react';

/**
 * ActivityChart — commits (bars) + PRs opened/merged (lines)
 * Accepts pre-aggregated buckets from the dashboard API.
 * Pure presentational component — no data transformation.
 */

const COLORS = {
  commits: 'var(--chart-1)',
  prsOpened: 'var(--chart-2)',
  prsMerged: 'var(--chart-3)',
  prior: 'var(--chart-5)',
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  const day = payload[0]?.payload?.bucketStart || label;
  const formatted = day
    ? new Date(day).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : '—';

  return (
    <div className="bg-surface border border-border rounded-md p-8 shadow-lg min-w-[200px]">
      <p className="text-sm font-medium text-text mb-4">{formatted}</p>
      <div className="space-y-2">
        {payload.map((entry, index) => {
          const color = COLORS[entry.dataKey] || COLORS.commits;
          const name =
            entry.dataKey === 'commits'
              ? 'Commits'
              : entry.dataKey === 'prsOpened'
                ? 'PRs opened'
                : entry.dataKey === 'prsMerged'
                  ? 'PRs merged'
                  : entry.dataKey === 'priorCommits'
                    ? 'Prior commits'
                    : entry.dataKey === 'priorPrsOpened'
                      ? 'Prior PRs opened'
                      : entry.dataKey === 'priorPrsMerged'
                        ? 'Prior PRs merged'
                        : entry.dataKey;
          const value = entry.value;
          return (
            <div key={index} className="flex items-center gap-8">
              <span className="w-12 h-2 rounded" style={{ backgroundColor: color }} />
              <span className="text-sm text-text2">{name}</span>
              <span className="font-mono font-medium text-text ml-auto">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CustomLegend = ({ payload }) => (
  <div className="flex flex-wrap gap-12">
    {payload.map((entry, index) => {
      const color = COLORS[entry.dataKey] || COLORS.commits;
      const name =
        entry.dataKey === 'commits'
          ? 'Commits'
          : entry.dataKey === 'prsOpened'
            ? 'PRs opened'
            : entry.dataKey === 'prsMerged'
              ? 'PRs merged'
              : entry.dataKey === 'priorCommits'
                ? 'Prior commits'
                : entry.dataKey === 'priorPrsOpened'
                  ? 'Prior PRs opened'
                  : entry.dataKey === 'priorPrsMerged'
                    ? 'Prior PRs merged'
                    : entry.dataKey;
      const isPrior = entry.dataKey.startsWith('prior');
      return (
        <div key={index} className="flex items-center gap-8" style={{ opacity: isPrior ? 0.6 : 1 }}>
          <span
            className="w-12 h-2 rounded"
            style={{ backgroundColor: color, borderStyle: isPrior ? 'dashed' : 'solid' }}
          />
          <span className={`text-sm ${isPrior ? 'text-text3' : 'text-text2'}`}>{name}</span>
        </div>
      );
    })}
  </div>
);

function formatXAxisLabel(value) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const ActivityChart = memo(function ActivityChart({ buckets, height = 320 }) {
  // Filter out buckets with no data at all
  const hasData = buckets.some((b) => b.commits > 0 || b.prsOpened > 0 || b.prsMerged > 0);

  if (!buckets.length || !hasData) {
    return (
      <div
        className="flex items-center justify-center bg-surface rounded-md border border-border"
        style={{ height }}
      >
        <div className="text-center text-text3 p-16">
          <p className="font-medium text-text">No activity in this range</p>
          <p className="text-sm text-text3 mt-4">Try a longer range or check unsynced repositories.</p>
        </div>
      </div>
    );
  }

  // Prepare data for Recharts
  const chartData = buckets.map((b) => ({
    bucketStart: b.bucketStart,
    commits: b.commits || 0,
    prsOpened: b.prsOpened || 0,
    prsMerged: b.prsMerged || 0,
  }));

  // Legend is rendered outside the plot region (below the chart) so it can
  // never overlap the bars, lines, or axis labels. Recharts reserves no
  // layout space for a custom Legend inside the chart, so an in-chart legend
  // can collide with the plot on narrower widths (design_system.md §17).
  const legendPayload = [{ dataKey: 'commits' }, { dataKey: 'prsOpened' }, { dataKey: 'prsMerged' }];

  return (
    <div className="w-full">
      <div
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Activity chart showing commits and PRs over time"
      >
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="bucketStart"
              tickFormatter={formatXAxisLabel}
              tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}
              axisLine={false}
              tickLine={false}
              dy={8}
            />
            <YAxis
              domain={[0, 'dataMax + 1']}
              tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}
              axisLine={false}
              tickLine={false}
              dx={-8}
              tickFormatter={(v) => (Number.isInteger(v) ? v : '')}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              dataKey="commits"
              name="Commits"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
            <Line
              dataKey="prsOpened"
              name="PRs opened"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              type="monotone"
            />
            <Line
              dataKey="prsMerged"
              name="PRs merged"
              stroke="var(--chart-3)"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 4 }}
              type="monotone"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-8">
        <CustomLegend payload={legendPayload} />
      </div>
    </div>
  );
});

export default ActivityChart;
