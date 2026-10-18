/**
 * Display-only formatting helpers (architecture.md §4 `lib/format.js`).
 * Canonical metrics are ALWAYS computed server-side; these only shape text.
 */

/**
 * Compact a count for KPI display: 12400 → "12.4k".
 * @param {number} value
 */
export function formatCount(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (Math.abs(value) >= 1000) {
    const compact = (value / 1000).toFixed(1).replace(/\.0$/, '');
    return `${compact}k`;
  }
  return String(value);
}

/**
 * Relative "x ago" label for timestamps.
 * @param {string|number|Date} input
 * @param {number} [nowMs]
 */
export function formatAgo(input, nowMs = Date.now()) {
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) {
    return '—';
  }
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
