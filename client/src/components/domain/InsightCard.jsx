import Badge from '../ui/Badge.jsx';
import { formatAgo } from '../../lib/format.js';

const CONFIDENCE_TONES = { High: 'success', Medium: 'warning', Low: 'info' };

/**
 * One deterministic insight (design_system.md §18/§20): title, text,
 * confidence badge with text, metric chips, and provenance. These are
 * product-generated template insights (Phase 4) — no AI UI here (T6 adds
 * that separately).
 */
export default function InsightCard({ insight, children }) {
  const { title, text, confidence, metrics, generatedAt, range } = insight;

  return (
    <li className="flex flex-col gap-8 rounded-md border border-border bg-surface p-16">
      <div className="flex flex-wrap items-center gap-8">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-text">{title}</h2>
        <Badge tone="info">Product insight</Badge>
        <Badge tone={CONFIDENCE_TONES[confidence] ?? 'neutral'}>{confidence ?? 'Unknown'} confidence</Badge>
      </div>
      <p className="text-sm text-text2">{text}</p>
      {metrics && Object.keys(metrics).length > 0 && (
        <div className="flex flex-wrap gap-8">
          {Object.entries(metrics).map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-4 rounded-md bg-surface2 px-8 py-4 text-sm text-text2"
            >
              <span className="text-text">{key}:</span>
              <span className="mono font-medium text-text">{String(value)}</span>
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-text2">
        Deterministic · computed from your synced data{range ? ` · ${range}` : ''}
        {generatedAt ? ` · generated ${formatAgo(generatedAt)}` : ''}
      </p>
      {children}
    </li>
  );
}
