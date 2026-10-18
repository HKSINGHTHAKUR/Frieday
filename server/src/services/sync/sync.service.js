/**
 * Sync service (T2.3) — start/status coordination over the sync store.
 *
 * `startSync` validates the request, loads the user's encrypted GitHub
 * token, claims the single-flight job (race-safe via SyncJob's partial
 * unique index), and launches the orchestrator in the background without
 * awaiting it. `getStatus` shapes the latest job + resource states into the
 * documented status payload. All persistence goes through the injected
 * `store` (Mongoose in production, in-memory fake in tests); all GitHub
 * work goes through the injected fetchers via the orchestrator.
 */

const logger = require('../../utils/logger');
const User = require('../../models/User');
const mongoStore = require('./sync.store');
const { runSync, SYNC_TIMEOUT_MS } = require('./sync.orchestrator');

const VALID_KINDS = ['initial', 'resync', 'incremental'];
const HISTORY_LIMIT = 20;
const STALE_GRACE_MS = 5 * 60 * 1000;
const INTERRUPTED_MESSAGE =
  'Sync was interrupted (process restarted or timed out). Start a new sync to resume from saved checkpoints.';

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.retryable = false;
  return err;
}

function unauthenticatedError(message) {
  const err = new Error(message);
  err.code = 'UNAUTHENTICATED';
  err.status = 401;
  err.retryable = false;
  return err;
}

function conflictError(active) {
  const err = new Error('A sync is already running for this account. Wait for it to finish, then try again.');
  err.code = 'SYNC_CONFLICT';
  err.status = 409;
  err.retryable = false;
  err.details = active
    ? { jobId: active.id, status: active.status, phase: active.progress?.phase ?? null }
    : undefined;
  return err;
}

function internalError(message) {
  const err = new Error(message);
  err.code = 'INTERNAL';
  err.status = 500;
  err.retryable = true;
  return err;
}

/** Wrap unexpected store/driver failures so callers always see typed errors. */
function toServiceError(err, what) {
  if (err && typeof err.code === 'string' && err.code.length > 0) return err;
  return internalError(`${what} is temporarily unavailable. Try again shortly.`);
}

async function defaultLoadUser(userId) {
  const doc = await User.findById(userId).select('+githubTokenEnc login').lean().exec();
  return doc ? { githubTokenEnc: doc.githubTokenEnc ?? null, login: doc.login ?? null } : null;
}

function defaultLaunch(runPromise, { jobId, userId }) {
  runPromise.catch((err) => {
    const code = err && typeof err.code === 'string' && err.code.length > 0 ? err.code : 'INTERNAL';
    logger.error({ jobId, userId, code, operation: 'background-sync' });
  });
}

function isStale(active, timeoutMs) {
  if (!active || !active.startedAt) return false;
  const age = Date.now() - new Date(active.startedAt).getTime();
  return age > timeoutMs + STALE_GRACE_MS;
}

/**
 * Claim the single-flight job: reap a stale active job, then create the new
 * running job (duplicate-key → another claimant won → 409). History beyond
 * the cap is pruned best-effort (a prune failure must never strand a claimed
 * job, so it is logged, never thrown).
 */
async function claimActive(userId, kind, store, timeoutMs, log) {
  const active = await store.findActiveJob(userId);
  if (active) {
    if (isStale(active, timeoutMs)) {
      const reaped = await store.finishJobCAS(active.id, {
        status: 'failed',
        error: INTERRUPTED_MESSAGE,
        errorCode: 'INTERNAL',
      });
      log.warn({ userId, msg: 'stale sync job reaped', jobId: active.id, reaped: reaped !== null });
    } else {
      throw conflictError(active);
    }
  }
  let job;
  try {
    job = await store.createJob({
      userId,
      kind,
      progress: { phase: 'repositories', done: 0, total: 1 },
      startedAt: new Date(),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      throw conflictError(await store.findActiveJob(userId));
    }
    throw err;
  }
  await pruneHistory(userId, store, log);
  return job;
}

/**
 * Keep per-user job history bounded (architecture.md §6: capped at 20/user).
 * Best-effort: a prune failure is logged, never thrown — the claimed job
 * must not be stranded by housekeeping.
 */
async function pruneHistory(userId, store, log) {
  try {
    if ((await store.countJobs(userId)) <= HISTORY_LIMIT) return;
    const recent = await store.listHistory(userId, HISTORY_LIMIT);
    await store.deleteJobsExcept(
      userId,
      recent.map((j) => j.id)
    );
  } catch {
    // err.message may embed driver/connection details — safe metadata only.
    log.warn({ userId, msg: 'sync history prune skipped', operation: 'history-prune' });
  }
}

/**
 * Start a sync: validate → load token → claim → launch in background.
 * Resolves promptly with the claimed job (202 semantics); the run itself
 * continues asynchronously. Rejects with typed errors (VALIDATION_ERROR /
 * UNAUTHENTICATED / SYNC_CONFLICT / INTERNAL).
 */
async function startSync(
  userId,
  {
    kind,
    store = mongoStore,
    fetchers,
    persist,
    loadUser = defaultLoadUser,
    launch = defaultLaunch,
    timeoutMs = SYNC_TIMEOUT_MS,
    log = logger,
  } = {}
) {
  if (!userId) throw internalError('Cannot start a sync without a user.');
  const cleanKind = kind === undefined ? 'initial' : kind;
  if (!VALID_KINDS.includes(cleanKind)) {
    throw validationError(`kind must be one of: ${VALID_KINDS.join(', ')}.`);
  }
  let userDoc;
  try {
    userDoc = await loadUser(userId);
  } catch (err) {
    throw toServiceError(err, 'Account lookup');
  }
  if (!userDoc || !userDoc.githubTokenEnc) {
    throw unauthenticatedError('No connected GitHub account. Reconnect GitHub and try again.');
  }
  let job;
  try {
    job = await claimActive(userId, cleanKind, store, timeoutMs, log);
  } catch (err) {
    throw toServiceError(err, 'Sync claim');
  }
  // `persist` (T3.2 seam) is forwarded so tests can inject the fake
  // persistence namespace; production omits it and runSync uses the real one.
  const runPromise = runSync({
    userId,
    userDoc,
    userLogin: userDoc.login ?? null,
    jobId: job.id,
    store,
    fetchers,
    persist,
    timeoutMs,
    log,
  });
  launch(runPromise, { jobId: job.id, userId });
  return { jobId: job.id, status: job.status, kind: job.kind, startedAt: job.startedAt };
}

function summarizeJob(job) {
  if (!job) return null;
  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  };
}

/**
 * Shape the documented status payload (architecture.md §5) from the latest
 * job + resource states. No active or finished job → clean `idle` payload
 * (resource states are still included so last-synced display keeps working).
 */
function buildStatusPayload({ job, states, history }) {
  const resources = {};
  for (const [name, state] of states.entries()) {
    resources[name] = { status: state.status, lastSyncedAt: state.lastSyncedAt, error: state.error };
  }
  const payload = {
    status: 'idle',
    jobId: null,
    kind: null,
    phase: null,
    done: 0,
    total: 0,
    perResource: {},
    counts: {},
    error: null,
    resumeAt: null,
    startedAt: null,
    finishedAt: null,
    resources,
    history: (history ?? []).map(summarizeJob),
  };
  if (!job) return payload;
  payload.status = job.status;
  payload.jobId = job.id;
  payload.kind = job.kind;
  payload.phase = job.progress?.phase ?? null;
  payload.done = job.progress?.done ?? 0;
  payload.total = job.progress?.total ?? 0;
  payload.perResource = job.perResource ?? {};
  payload.counts = job.counts ?? {};
  payload.startedAt = job.startedAt;
  payload.finishedAt = job.finishedAt;
  payload.resumeAt = job.resumeAt;
  if (job.error) {
    payload.error = { code: job.errorCode ?? 'INTERNAL', message: job.error };
  }
  return payload;
}

/**
 * Current user-scoped sync status. Never trusts client input for identity:
 * callers pass the session-derived userId.
 */
async function getStatus(userId, { store = mongoStore } = {}) {
  if (!userId) throw internalError('Cannot read sync status without a user.');
  let job;
  let states;
  let history;
  try {
    job = await store.getLatestJob(userId);
    states = await store.getStates(userId);
    history = await store.listHistory(userId, HISTORY_LIMIT);
  } catch (err) {
    throw toServiceError(err, 'Sync status');
  }
  return buildStatusPayload({ job, states, history });
}

module.exports = {
  VALID_KINDS,
  HISTORY_LIMIT,
  STALE_GRACE_MS,
  INTERRUPTED_MESSAGE,
  startSync,
  getStatus,
  buildStatusPayload,
  claimActive,
  defaultLoadUser,
};
