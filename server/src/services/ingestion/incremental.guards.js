/**
 * Pure guards + shared helpers for T7.2 incremental ingest.
 *
 * Everything here is deterministic and side-effect free, so the runner
 * (`incremental.ingest.js`) and the trigger (`incremental.trigger.js`) can
 * share it without mixing concerns: freshness math, the stale-event timestamp
 * guard, and the typed-error construction used across the ingest path.
 */
const { shortMessage } = require('../sync/sync.phases');

/**
 * Deterministic freshness measurement (webhook received -> ingestion
 * completed). Returns the duration in milliseconds, or null when any
 * timestamp is missing/invalid (nothing can be measured honestly).
 * @param {{ receivedAt?: number, startedAt?: number, completedAt?: number }} ts
 * @returns {number|null}
 */
function computeFreshnessMs({ receivedAt, startedAt, completedAt } = {}) {
  const all = [receivedAt, startedAt, completedAt];
  if (all.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const ordered = receivedAt <= startedAt && startedAt <= completedAt;
  return ordered ? completedAt - receivedAt : null;
}

/**
 * Stale-event timestamp guard (architecture.md §9, rules.md §6). An event is
 * stale when its newest verified GitHub timestamp is at or before the
 * repository's persisted boundary, so processing it could neither add newer
 * data nor move the boundary forward. Missing event timestamp or missing
 * persisted boundary means the guard cannot classify -> NOT stale (eligible);
 * the T3.2 newer-wins persistence guards against any regression regardless.
 * @param {Date|null|undefined} eventTimestamp newest verified timestamp in the event
 * @param {Date|null|undefined} persistedBoundary Repository.githubUpdatedAt at last sync
 * @returns {boolean} true when the event is stale and must be ignored
 */
function isStaleEvent(eventTimestamp, persistedBoundary) {
  if (!(eventTimestamp instanceof Date) || !Number.isFinite(eventTimestamp.getTime())) return false;
  if (!(persistedBoundary instanceof Date) || !Number.isFinite(persistedBoundary.getTime())) return false;
  return eventTimestamp.getTime() <= persistedBoundary.getTime();
}

/**
 * Newest verified GitHub timestamp in a validated event payload. Anything
 * unparseable is ignored (the guard then cannot classify -> eligible).
 * @param {{ repository?: object, pull_request?: object, issue?: object }} payload
 * @returns {Date|null}
 */
function extractEventTimestamp(payload) {
  const candidates = [
    payload?.repository?.updated_at,
    payload?.pull_request?.updated_at,
    payload?.issue?.updated_at,
  ];
  let newest = null;
  for (const raw of candidates) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  return newest === null ? null : new Date(newest);
}

function internalError(message) {
  const err = new Error(message);
  err.code = 'INTERNAL';
  err.retryable = true;
  return err;
}

function timeoutError(timeoutMs) {
  const err = new Error('Incremental sync timed out. Progress was saved; a later sync will resume.');
  err.code = 'INTERNAL';
  err.retryable = true;
  err.timeout = true;
  err.details = { timeoutMs };
  return err;
}

function terminalInfo(err) {
  if (err && err.code === 'RATE_LIMITED') {
    return {
      errorCode: 'RATE_LIMITED',
      message: shortMessage(err.message, 'GitHub rate limit reached.'),
      resumeAt: err.resumeAt instanceof Date ? err.resumeAt : null,
    };
  }
  if (err && err.code === 'UNAUTHENTICATED') {
    return {
      errorCode: 'UNAUTHENTICATED',
      message: shortMessage(err.message, 'GitHub connection expired.'),
      resumeAt: null,
    };
  }
  if (err && typeof err.code === 'string' && err.code.length > 0) {
    return {
      errorCode: err.code,
      message: shortMessage(err.message, 'Incremental sync failed.'),
      resumeAt: null,
    };
  }
  return {
    errorCode: 'INTERNAL',
    message: 'Incremental sync failed unexpectedly.',
    resumeAt: null,
  };
}

/**
 * First per-repo error entry with the given envelope code (GitHub-level fatal
 * conditions dominate triage, mirroring sync.phases.firstErrorWithCode).
 * @param {Map} errors per-repo error map
 * @param {string} code envelope code to find
 * @returns {object|null} the first matching entry, or null
 */
function firstFatalError(errors, code) {
  for (const entry of errors.values()) {
    if (entry && entry.code === code) return entry;
  }
  return null;
}

function fatalFromEntry(entry, code, fallback) {
  const err = new Error(entry?.message ?? fallback);
  err.code = code;
  if (code === 'RATE_LIMITED' && entry?.resumeAt instanceof Date) err.resumeAt = entry.resumeAt;
  return err;
}

module.exports = {
  computeFreshnessMs,
  isStaleEvent,
  extractEventTimestamp,
  internalError,
  timeoutError,
  terminalInfo,
  firstFatalError,
  fatalFromEntry,
};
