import Card from '../ui/Card.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import Badge from '../ui/Badge.jsx';

/**
 * InsightsCard — deterministic product insight summaries with metrics and
 * confidence badges. Renders rows from the dashboard payload `insights` array.
 */
export default function InsightsCard({ insights = [] }) {
  return (
    <Card
      title="Insights"
      action={
        <a href="/insights" className="text-sm text-accent underline">
          View all
        </a>
      }
    >
      {insights.length === 0 ? (
        <EmptyState title="No insights yet" body="Insights appear after enough activity data is collected." />
      ) : (
        <ul className="space-y-16" role="list" aria-label="Insights">
          {insights.slice(0, 4).map((insight) => {
            // Composite key: per-repo insights (e.g. project_health) share a
            // templateId but are keyed by (templateId, repoId) — matching the
            // Insight upsert identity. Aggregate insights fall back to
            // templateId alone.
            const key = `${insight.templateId}-${String(insight.metrics?.repoId ?? '')}`;
            return (
              <li key={key} className="border border-border rounded-md p-16 bg-surface">
                <div className="flex-1">
                  <div className="flex items-center gap-8 mb-4">
                    <span className="font-medium text-text">{insight.title}</span>
                    <Badge tone="info">Product insight</Badge>
                  </div>
                  <p className="text-text2">{insight.text}</p>
                  <div className="mt-8 flex flex-wrap gap-8">
                    {Object.entries(insight.metrics || {}).map(([k, v]) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-4 px-8 py-4 rounded-md bg-surface2 text-sm text-text2"
                      >
                        <span className="text-text3">{k}:</span>
                        <span className="font-mono font-medium text-text">{v}</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-8 flex items-center gap-8">
                    <Badge tone="info">{insight.confidence}</Badge>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
