import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { memo } from 'react';

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;

  const entry = payload[0];
  const { name, value, payload: entryPayload } = entry;
  const total = entryPayload?.total || 0;
  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
  const commitShare =
    entryPayload?.commitShare !== undefined ? `${entryPayload.commitShare.toFixed(1)}%` : '—';

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
          <span className="font-mono font-medium text-text">{formatBytes(entryPayload?.bytes || 0)}</span>
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

const LanguageDonut = memo(function LanguageDonut({ data }) {
  // data: { weightedBytes: { TypeScript: 1000, JavaScript: 500 }, commitShare: { ... } }
  // We use weightedBytes for the donut visualization
  const weightedBytes = data?.weightedBytes || {};

  const total = Object.values(weightedBytes).reduce((a, b) => a + b, 0);

  if (!total) {
    return (
      <div className="h-[280px] w-full flex items-center justify-center bg-surface rounded-md border border-border">
        <div className="text-center text-text3 p-16">
          <p className="font-medium text-text">No language data</p>
          <p className="text-sm text-text3 mt-4">Sync repositories to see language breakdown.</p>
        </div>
      </div>
    );
  }

  const pieData = Object.entries(data.weightedBytes).map(([name, value]) => ({
    name,
    value,
    total: data.totalBytes || Object.values(data.weightedBytes).reduce((a, b) => a + b, 0),
  }));

  // Limit to top 5 + Other
  const sorted = [...pieData].sort((a, b) => b.value - a.value);
  const top5 = sorted.slice(0, 5);
  const otherValue = pieData.length > 5 ? pieData.slice(5).reduce((sum, d) => sum + d.value, 0) : 0;
  const dataForChart = otherValue > 0 ? [...top5, { name: 'Other', value: otherValue }] : top5;

  return (
    <div className="h-[280px] w-full" role="img" aria-label="Language breakdown donut chart">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={dataForChart}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
            labelLine={false}
          >
            {Object.entries(data.weightedBytes)
              .slice(0, 5)
              .map((_, index) => (
                <Cell
                  key={index}
                  fill={
                    [
                      'var(--chart-1)',
                      'var(--chart-2)',
                      'var(--chart-3)',
                      'var(--chart-4)',
                      'var(--chart-5)',
                      'var(--chart-6)',
                    ][index % 6]
                  }
                />
              ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
});

export default LanguageDonut;
