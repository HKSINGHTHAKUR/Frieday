import { useSearchParams } from 'react-router-dom';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorCard from '../components/ui/ErrorCard.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import InsightCard from '../components/domain/InsightCard.jsx';
import EvidenceExpander from '../components/domain/EvidenceExpander.jsx';
import ExplainSection from '../components/domain/ExplainSection.jsx';
import { useInsights } from '../hooks/useInsights.js';

const RANGES = ['30d', '90d', '12m'];

/**
 * Insights feed (tasks.md T5.3): stored deterministic insights from
 * GET /api/insights?range=. Range is URL-synced; the feed renders stored
 * data as-is and never recomputes insight math in the frontend.
 */
export default function Insights() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('range');
  const range = RANGES.includes(requested) ? requested : '30d';
  const insights = useInsights(range);

  const setRange = (value) => {
    const params = new URLSearchParams(searchParams);
    if (value === '30d') {
      params.delete('range');
    } else {
      params.set('range', value);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <h1 className="text-xl font-bold text-text">Insights</h1>
        <div role="group" aria-label="Time range" className="inline-flex items-center gap-8">
          {RANGES.map((r) => (
            <Button
              key={r}
              variant={range === r ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>
      <InsightsBody range={range} result={insights} />
    </div>
  );
}

function InsightsBody({ range, result }) {
  const { insights, loading, error, refetch } = result;

  if (loading) {
    return (
      <div className="flex flex-col gap-16">
        {[0, 1, 2].map((i) => (
          <Card key={i} title="Insight">
            <Skeleton className="h-64 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorCard
        title="Could not load insights"
        message={error?.message || 'Unknown error'}
        requestId={error?.requestId}
        onRetry={refetch}
      />
    );
  }

  if (insights.length === 0) {
    return (
      <EmptyState
        title="Not enough data for insights yet"
        body="Insights appear after your first full sync with 5+ events. They are computed automatically from your own activity."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-16" role="list" aria-label="Insights feed">
      {insights.map((insight) => (
        <InsightCard key={insight.id ?? insight.templateId} insight={{ ...insight, range }}>
          {/* T6.2: user-triggered Explain + AI summary well, evidence always adjacent. */}
          <ExplainSection
            insightId={insight.id}
            evidence={<EvidenceExpander evidence={insight.evidence} />}
          />
        </InsightCard>
      ))}
    </ul>
  );
}
