/**
 * Incremental single-repository ingest runner (T7.2, architecture.md §9,
 * tasks.md T7.2, prd.md F11).
 *
 * Runs the ONE-repo incremental pipeline (commits/pulls/issues/languages)
 * for an already-claimed `kind: 'incremental'` job, using the same T2.2
 * fetchers, T3.2 persistence, and T2.1 rate-limit gate as the full
 * orchestrator. Reached ONLY from the T7.1 trusted handler boundary (see
 * `incremental.trigger.js`). Boundary: `since = Repository.lastSyncedAt`;
 * no per-repo SyncState cursor envelopes are written, so full-sync resume
 * checkpoints are never disturbed. On success the per-repo boundary advances
 * via `store.markRepoSynced`. Errors are typed, never swallowed; partial
 * failures keep prior good data.
 */
const logger = require('../../utils/logger');
const commitsFetcher = require('../github/commits.fetcher');
const pullsFetcher = require('../github/pulls.fetcher');
const issuesFetcher = require('../github/issues.fetcher');
const languagesFetcher = require('../github/languages.fetcher');
const persistNamespace = require('../normalization/persist');
const { requestRecompute } = require('../normalization/recompute');
const {
  internalError,
  timeoutError,
  terminalInfo,
  firstFatalError,
  fatalFromEntry,
} = require('./incremental.guards');

const INCREMENTAL_TIMEOUT_MS = 15 * 60 * 1000; // same job timeout as a full sync (architecture.md §8)
const RESOURCES = [
  { resource: 'commits', fetch: 'fetchCommits', list: 'commits' },
  { resource: 'pulls', fetch: 'fetchPulls', list: 'prs' },
  { resource: 'issues', fetch: 'fetchIssues', list: 'issues' },
  { resource: 'languages', fetch: 'fetchLanguages', list: 'languageSnapshots' },
];

const defaultFetchers = {
  fetchCommits: commitsFetcher.fetchCommitsForRepositories,
  fetchPulls: pullsFetcher.fetchPullRequestsForRepositories,
  fetchIssues: issuesFetcher.fetchIssuesForRepositories,
  fetchLanguages: languagesFetcher.fetchLanguagesForRepositories,
};

function buildContext(opts) {
  const { userId, userDoc, jobId, store, repo } = opts;
  if (!userId || !userDoc || !jobId || !store) {
    throw internalError('runIncrementalRepoSync requires userId, userDoc, jobId, and store.');
  }
  if (
    !repo ||
    typeof repo.owner !== 'string' ||
    typeof repo.name !== 'string' ||
    !Number.isInteger(repo.githubId)
  ) {
    throw internalError('runIncrementalRepoSync requires a single resolved repository.');
  }
  const ctx = {
    userId,
    userDoc,
    jobId,
    store,
    repo,
    log: opts.log ?? logger,
    fetchers: opts.fetchers ?? defaultFetchers,
    persist: opts.persist ?? persistNamespace,
    recompute: opts.recompute ?? requestRecompute,
    userLogin: opts.userLogin ?? null,
    timeoutMs:
      Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : INCREMENTAL_TIMEOUT_MS,
    repoDoc: { owner: repo.owner, name: repo.name, repoId: repo.githubId },
    cursors: new Map(),
    perResource: {},
    counts: {},
    capReached: false,
    done: 0,
    total: RESOURCES.length,
  };
  if (opts.since instanceof Date) {
    ctx.cursors.set(`${repo.owner}/${repo.name}`, { since: opts.since.toISOString() });
  }
  return ctx;
}

function createTerminalPatchers({ store, jobId, userId, log }) {
  let finished = false;
  const finishOnce = async (patch) => {
    if (finished) return null;
    finished = true;
    try {
      return await store.finishJobCAS(jobId, patch);
    } catch (err) {
      finished = false;
      throw err;
    }
  };
  const persistTerminal = async (patch) => {
    try {
      return await finishOnce(patch);
    } catch (finishErr) {
      const code =
        finishErr && typeof finishErr.code === 'string' && finishErr.code.length > 0
          ? finishErr.code
          : 'INTERNAL';
      log.error({ jobId, userId, msg: 'terminal state write failed', code, operation: 'terminal-write' });
      throw internalError('Incremental sync state could not be persisted.');
    }
  };
  return { persistTerminal };
}

function createDeadline(timeoutMs) {
  let timer = null;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
    if (timer.unref) timer.unref();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Fetch + persist ONE resource for the single repo. Global conditions
 * (RATE_LIMITED / UNAUTHENTICATED) throw (abort the run); anything else is
 * recorded as a per-resource failure so the run can continue.
 */
async function runResource(ctx, cfg) {
  const phase = cfg.resource;
  let out;
  let thrown;
  try {
    out = await ctx.fetchers[cfg.fetch](ctx.userDoc, [ctx.repoDoc], { cursors: ctx.cursors });
  } catch (err) {
    thrown = err;
  }
  if (thrown) {
    if (thrown.code === 'RATE_LIMITED' || thrown.code === 'UNAUTHENTICATED') throw thrown;
    ctx.perResource[phase] = 'failed';
    ctx.counts[phase] = 0;
    ctx.done += 1;
    await ctx.store.saveProgress(ctx.jobId, { phase, done: ctx.done, total: ctx.total });
    ctx.log.warn({
      jobId: ctx.jobId,
      userId: ctx.userId,
      msg: 'incremental resource failed',
      resource: phase,
      code: thrown.code ?? 'INTERNAL',
    });
    return;
  }
  const list = out && Array.isArray(out[cfg.list]) ? out[cfg.list] : [];
  const errors = out && out.errors instanceof Map ? out.errors : new Map();
  if (out && out.capReached) ctx.capReached = true;
  const rateEntry = firstFatalError(errors, 'RATE_LIMITED');
  if (rateEntry) throw fatalFromEntry(rateEntry, 'RATE_LIMITED', 'GitHub rate limit reached.');
  const authEntry = firstFatalError(errors, 'UNAUTHENTICATED');
  if (authEntry) throw fatalFromEntry(authEntry, 'UNAUTHENTICATED', 'GitHub connection expired.');
  const persisted = await ctx.persist.persistFetched(ctx.userId, phase, list, {
    userLogin: ctx.userLogin,
    repoIdMap: ctx.repoIdMap,
  });
  ctx.counts[phase] = persisted.persisted;
  ctx.perResource[phase] =
    persisted.invalid.length > 0 || persisted.writeErrors.length > 0 || errors.size > 0 ? 'failed' : 'done';

  // Update SyncState freshness timestamp on successful resource persistence
  if (ctx.perResource[phase] === 'done') {
    try {
      await ctx.store.saveState(ctx.userId, phase, {
        status: 'done',
        lastSyncedAt: new Date(),
        error: null,
      });
    } catch (err) {
      ctx.log.warn({
        jobId: ctx.jobId,
        userId: ctx.userId,
        msg: 'failed to update SyncState freshness',
        resource: phase,
        error: err.message,
      });
      // Don't fail the entire pipeline if cache update fails
    }
  }

  ctx.done += 1;
  await ctx.store.saveProgress(ctx.jobId, { phase, done: ctx.done, total: ctx.total });
}

async function runPipeline(ctx) {
  ctx.repoIdMap = await ctx.persist.loadRepoIdMap(ctx.userId, [ctx.repo.githubId]);
  for (const cfg of RESOURCES) await runResource(ctx, cfg);
  const anyFailed = Object.values(ctx.perResource).includes('failed');
  if (anyFailed) {
    return {
      status: 'failed',
      errorCode: 'INTERNAL',
      message: 'Incremental sync completed with per-resource errors.',
    };
  }
  return { status: 'succeeded' };
}

async function finalizeRun(ctx, outcome, persistTerminal) {
  if (outcome.status === 'succeeded') {
    if (!ctx.capReached) {
      await ctx.store.markRepoSynced(ctx.userId, ctx.repo.githubId, new Date());
    } else {
      // A resource hit its fetch cap: advancing the boundary would skip the
      // un-fetched remainder forever. Retain the previous boundary so the
      // next incremental run picks it up (idempotent upserts, no duplicates).
      ctx.log.warn({
        jobId: ctx.jobId,
        userId: ctx.userId,
        repo: ctx.repo.githubId,
        msg: 'incremental sync hit a fetch cap; per-repo boundary not advanced',
      });
    }
    try {
      await ctx.recompute(ctx.userId, {
        jobId: ctx.jobId,
        status: 'succeeded',
        repoId: ctx.repo.githubId,
        source: 'webhook',
      });
    } catch (hookErr) {
      const code =
        hookErr && typeof hookErr.code === 'string' && hookErr.code.length > 0 ? hookErr.code : 'INTERNAL';
      ctx.log.warn({
        jobId: ctx.jobId,
        userId: ctx.userId,
        msg: 'recompute trigger skipped',
        code,
        operation: 'recompute-trigger',
      });
    }
  }
  const terminal =
    outcome.status === 'succeeded'
      ? {
          status: 'succeeded',
          perResource: ctx.perResource,
          counts: ctx.counts,
          error: null,
          errorCode: null,
          resumeAt: null,
        }
      : {
          status: 'failed',
          perResource: ctx.perResource,
          counts: ctx.counts,
          error: outcome.message,
          errorCode: outcome.errorCode,
          resumeAt: null,
        };
  await persistTerminal(terminal);
  ctx.log.info({
    jobId: ctx.jobId,
    userId: ctx.userId,
    repo: ctx.repo.githubId,
    msg: 'incremental sync finished',
    status: terminal.status,
  });
  return { jobId: ctx.jobId, status: terminal.status, perResource: ctx.perResource, counts: ctx.counts };
}

/**
 * Run the single-repo incremental pipeline for an already-claimed job.
 * Resolves with a terminal summary; rejects only when the terminal state
 * could not be persisted (mirrors runSync semantics).
 * @param {object} opts
 * @param {string} opts.userId
 * @param {object} opts.userDoc `{ githubTokenEnc, login }` (memory only)
 * @param {string} opts.jobId claimed active job id
 * @param {{ owner: string, name: string, githubId: number }} opts.repo
 * @param {Date|null} [opts.since] incremental boundary (Repository.lastSyncedAt)
 * @param {object} opts.store persistence primitives (see sync.store.js)
 * @param {object} [opts.fetchers] T2.2 multi-fetchers (defaults to the real ones)
 * @param {object} [opts.persist] normalization/persist namespace
 * @param {Function} [opts.recompute] recompute trigger hook
 * @param {number} [opts.timeoutMs] run deadline
 * @param {object} [opts.log] pino-compatible logger
 * @returns {Promise<{ jobId: string, status: string, perResource: object, counts: object }>}
 */
async function runIncrementalRepoSync(opts = {}) {
  const ctx = buildContext(opts);
  const { persistTerminal } = createTerminalPatchers({
    store: ctx.store,
    jobId: ctx.jobId,
    userId: ctx.userId,
    log: ctx.log,
  });
  const { promise: timeoutPromise, cancel } = createDeadline(ctx.timeoutMs);
  try {
    const outcome = await Promise.race([runPipeline(ctx), timeoutPromise]);
    return await finalizeRun(ctx, outcome, persistTerminal);
  } catch (err) {
    const info = terminalInfo(err);
    await persistTerminal({
      status: 'failed',
      perResource: ctx.perResource,
      counts: ctx.counts,
      error: info.message,
      errorCode: info.errorCode,
      resumeAt: info.resumeAt,
    });
    ctx.log.warn({
      jobId: ctx.jobId,
      userId: ctx.userId,
      repo: ctx.repo.githubId,
      msg: 'incremental sync aborted',
      code: info.errorCode,
    });
    return { jobId: ctx.jobId, status: 'failed', perResource: ctx.perResource, counts: ctx.counts };
  } finally {
    cancel();
  }
}

module.exports = {
  INCREMENTAL_TIMEOUT_MS,
  RESOURCES,
  runIncrementalRepoSync,
};
