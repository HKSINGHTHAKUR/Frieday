import { useState } from 'react';
import Badge from '../ui/Badge.jsx';

/**
 * EvidenceExpander (design_system.md §18): "View evidence" expands an inline
 * table of the insight's stored evidence references. Every item comes from
 * the API payload (repoIds, commitShas, prNumbers, bucketStarts) — nothing
 * is fabricated. Repository links resolve to the user's own repo detail.
 */
export default function EvidenceExpander({ evidence }) {
  const [open, setOpen] = useState(false);
  const refs = collectEvidence(evidence);
  const isEmpty = refs.length === 0;

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs font-medium text-accent underline"
        disabled={isEmpty}
      >
        {open ? 'Hide evidence' : 'View evidence'}
      </button>
      {open && (
        <div className="mt-8 rounded-md border border-border bg-surface2 p-12">
          {isEmpty ? (
            <p className="text-xs text-text3">No evidence references recorded for this insight.</p>
          ) : (
            <ul className="flex flex-col gap-8">
              {refs.map((ref) => (
                <li key={ref.id} className="flex flex-wrap items-center gap-8 text-xs">
                  <Badge tone="neutral">{ref.kind}</Badge>
                  {ref.href ? (
                    <a href={ref.href} className="mono text-accent underline">
                      {ref.label}
                    </a>
                  ) : (
                    <span className="mono text-text2">{ref.label}</span>
                  )}
                  {ref.extra && <span className="text-text3">{ref.extra}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function collectEvidence(evidence) {
  if (!evidence) return [];
  const refs = [];
  for (const repoId of evidence.repoIds ?? []) {
    refs.push({ id: `repo-${repoId}`, kind: 'Repository', label: repoId, href: `/repositories/${repoId}` });
  }
  for (const sha of evidence.commitShas ?? []) {
    refs.push({ id: `sha-${sha}`, kind: 'Commit', label: sha.slice(0, 12) });
  }
  for (const number of evidence.prNumbers ?? []) {
    refs.push({ id: `pr-${number}`, kind: 'Pull request', label: `#${number}` });
  }
  for (const start of evidence.bucketStarts ?? []) {
    const date = start ? new Date(start) : null;
    const label =
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : String(start);
    refs.push({ id: `bucket-${start}`, kind: 'Bucket', label });
  }
  return refs;
}
