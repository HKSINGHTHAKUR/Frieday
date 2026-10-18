import { Bar, BarChart, ResponsiveContainer } from 'recharts';
import { memo } from 'react';

/**
 * RepoSparkline (design_system.md §17): 30-day mini bars, no axes, real
 * ActivityBucket data only. Empty/missing data renders nothing — never a
 * fake flatline. `role="img"` + a factual summary label; the adjacent text
 * and the detail tables are the accessible equivalents.
 */
export const RepoSparkline = memo(function RepoSparkline({ buckets = [], label }) {
  const hasData = buckets.some(
    (b) => (b.commits ?? 0) > 0 || (b.prsOpened ?? 0) > 0 || (b.prsMerged ?? 0) > 0
  );
  if (!buckets.length || !hasData) return null;

  const data = buckets.map((b) => ({
    bucketStart: b.bucketStart,
    commits: b.commits ?? 0,
    prsOpened: b.prsOpened ?? 0,
  }));
  const totalCommits = data.reduce((sum, b) => sum + b.commits, 0);
  const summary = label ?? `${totalCommits} commits over the last ${data.length} days`;

  return (
    <div role="img" aria-label={`Activity sparkline: ${summary}`} className="h-40 w-40" title={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Bar
            dataKey="commits"
            fill="var(--chart-1)"
            radius={[2, 2, 0, 0]}
            maxBarSize={6}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export default RepoSparkline;
