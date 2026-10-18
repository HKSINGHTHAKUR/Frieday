/**
 * Webhook event -> incremental-ingest trigger (T7.2, architecture.md §9).
 *
 * This is the T7.1 trusted-handler boundary's default handler: it receives an
 * already signature-verified, shape-validated, deduped trusted event and maps
 * it to incremental ingest for the affected repository. Repository identity is
 * resolved through the existing user-scoped Repository model (a payload
 * userId is never trusted); the stale-event timestamp guard runs per row; the
 * per-user single-flight job (kind 'incremental') is claimed through the
 * existing SyncJob partial unique index; and the single-repo run is launched
 * in the background so the webhook answers 200 promptly.
 *
 * Outcomes (typed, logged, never leak repo/user info in HTTP responses):
 * skipped-invalid-repo | skipped-unmapped | store-error | skipped-stale |
 * skipped-unconnected | conflict | queued.
 */
const logger = require('../../utils/logger');
const Repository = require('../../models/Repository');
const { defaultLoadUser, claimActive } = require('../sync/sync.service');
const mongoStore = require('../sync/sync.store');
const { isStaleEvent, extractEventTimestamp, computeFreshnessMs } = require('./incremental.guards');
const { INCREMENTAL_TIMEOUT_MS, runIncrementalRepoSync } = require('./incremental.ingest');

function defaultLaunch(runPromise, meta) {
  runPromise
    .then(() => {
      const log = meta.log ?? logger;
      const completedAt = Date.now();
      const durationMs = computeFreshnessMs({
        receivedAt: meta.receivedAt,
        startedAt: meta.startedAt,
        completedAt,
      });
      log.info({
        jobId: meta.jobId,
        userId: meta.userId,
        repo: meta.repo,
        event: meta.event,
        deliveryId: meta.deliveryId,
        msg: 'webhook freshness',
        receivedAt: meta.receivedAt,
        startedAt: meta.startedAt,
        completedAt,
        durationMs,
      });
    })
    .catch((err) => {
      const log = meta.log ?? logger;
      const code = err && typeof err.code === 'string' && err.code.length > 0 ? err.code : 'INTERNAL';
      log.error({
        jobId: meta.jobId,
        userId: meta.userId,
        repo: meta.repo,
        event: meta.event,
        deliveryId: meta.deliveryId,
        code,
        operation: 'incremental-background',
      });
    });
}

async function resolveRepoRows(repoModel, githubId) {
  return repoModel.find({ githubId }).select('userId owner name githubUpdatedAt lastSyncedAt').lean().exec();
}

/**
 * Resolve the trusted event to repo rows for its owning users, with typed
 * skip outcomes when the repo id is malformed or nothing is mapped.
 * @param {object} repoModel Repository model (or test fake)
 * @param {object} trustedEvent verified delivery metadata
 * @param {object} log pino-compatible logger
 * @returns {Promise<{ rows?: Array, githubId?: number, outcome?: object }>}
 */
async function resolveEventRepo(repoModel, trustedEvent, log) {
  const githubId = trustedEvent.repository?.id;
  if (!Number.isInteger(githubId)) {
    log.warn({
      event: trustedEvent.event,
      deliveryId: trustedEvent.deliveryId,
      result: 'skipped-invalid-repo',
    });
    return { outcome: { result: 'skipped-invalid-repo' } };
  }
  let rows;
  try {
    rows = await resolveRepoRows(repoModel, githubId);
  } catch (err) {
    log.error({
      event: trustedEvent.event,
      deliveryId: trustedEvent.deliveryId,
      code: err.code || 'INTERNAL',
      message: 'repository lookup failed',
    });
    return { outcome: { result: 'store-error' } };
  }
  if (rows.length === 0) {
    log.info({ event: trustedEvent.event, deliveryId: trustedEvent.deliveryId, result: 'skipped-unmapped' });
    return { outcome: { result: 'skipped-unmapped' } };
  }
  return { rows, githubId };
}

/**
 * Process ONE (user, repo) row: stale guard -> connectivity check ->
 * single-flight claim -> background launch. Never throws for expected
 * outcomes; returns a typed result.
 * @param {{ row: object, ctx: object }} parts
 * @returns {Promise<{ result: string, jobId?: string }>}
 */
async function processRepoRow({ row, ctx }) {
  const { log, trustedEvent } = ctx;
  const userId = String(row.userId);
  const logBase = { event: trustedEvent.event, deliveryId: trustedEvent.deliveryId, userId };
  if (isStaleEvent(ctx.eventTimestamp, row.githubUpdatedAt)) {
    log.info({ ...logBase, result: 'skipped-stale' });
    return { result: 'skipped-stale' };
  }
  let userDoc;
  try {
    userDoc = await ctx.loadUser(userId);
  } catch (err) {
    const code = err && typeof err.code === 'string' && err.code.length > 0 ? err.code : 'INTERNAL';
    log.error({ ...logBase, result: 'store-error', code, operation: 'load-user' });
    return { result: 'store-error' };
  }
  if (!userDoc || !userDoc.githubTokenEnc) {
    log.info({ ...logBase, result: 'skipped-unconnected' });
    return { result: 'skipped-unconnected' };
  }
  const repo = { owner: row.owner, name: row.name, githubId: row.githubId };
  let job;
  try {
    job = await ctx.claim(userId, 'incremental');
  } catch (err) {
    if (err && err.code === 'SYNC_CONFLICT') {
      log.info({ ...logBase, result: 'conflict' });
      return { result: 'conflict', jobId: err.details ? err.details.jobId : null };
    }
    const code = err && typeof err.code === 'string' && err.code.length > 0 ? err.code : 'INTERNAL';
    log.error({ ...logBase, result: 'store-error', code, operation: 'claim' });
    return { result: 'store-error' };
  }
  const startedAt = Date.now();
  const runPromise = runIncrementalRepoSync({
    userId,
    userDoc,
    userLogin: userDoc.login ?? null,
    jobId: job.id,
    repo,
    since: row.lastSyncedAt instanceof Date ? row.lastSyncedAt : null,
    store: ctx.store,
    fetchers: ctx.deps.fetchers,
    persist: ctx.deps.persist,
    recompute: ctx.deps.recompute,
    timeoutMs: ctx.timeoutMs,
    log,
  });
  ctx.launch(runPromise, {
    jobId: job.id,
    userId,
    repo: repo.githubId,
    event: trustedEvent.event,
    deliveryId: trustedEvent.deliveryId,
    receivedAt: ctx.receivedAt,
    startedAt,
    log,
  });
  return { result: 'queued', jobId: job.id };
}

/**
 * Default trusted-event handler (T7.1 boundary -> T7.2 ingest). Resolves the
 * affected repository to its owning user(s) through the user-scoped
 * Repository model, applies the stale guard per row, claims the per-user
 * single-flight job, and launches the single-repo incremental run in the
 * background. Never throws for expected outcomes; returns promptly.
 * @param {object} trustedEvent from processVerifiedDelivery (already
 *   signature-verified, shape-validated, deduped)
 * @param {object} [deps] overrides for tests (store, repoModel, loadUser,
 *   launch, fetchers, persist, recompute, timeoutMs)
 * @returns {Promise<{ outcomes: Array<{ result: string, jobId?: string }> }>}
 */
async function triggerIncrementalIngest(trustedEvent, deps = {}) {
  const log = deps.log ?? trustedEvent.log ?? logger;
  const store = deps.store ?? mongoStore;
  const loadUser = deps.loadUser ?? defaultLoadUser;
  const launch = deps.launch ?? defaultLaunch;
  const timeoutMs = deps.timeoutMs ?? INCREMENTAL_TIMEOUT_MS;
  const repoModel = deps.repoModel ?? Repository;
  const receivedAt = typeof trustedEvent.receivedAt === 'number' ? trustedEvent.receivedAt : Date.now();
  const eventTimestamp = extractEventTimestamp(trustedEvent.payload ?? {});

  const resolved = await resolveEventRepo(repoModel, trustedEvent, log);
  if (resolved.outcome) return { outcomes: [resolved.outcome] };

  const byUser = new Map();
  for (const row of resolved.rows) {
    const userId = String(row.userId);
    if (!byUser.has(userId)) byUser.set(userId, row);
  }

  const ctx = {
    log,
    trustedEvent,
    eventTimestamp,
    receivedAt,
    deps,
    store,
    loadUser,
    launch,
    timeoutMs,
    claim: (userId, kind) => claimActive(userId, kind, store, timeoutMs, log),
  };
  const outcomes = [];
  for (const row of byUser.values()) {
    outcomes.push(await processRepoRow({ row, ctx }));
  }
  return { outcomes };
}

module.exports = { triggerIncrementalIngest };
