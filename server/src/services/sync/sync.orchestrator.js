/**
 * Sync orchestrator (T2.3) — coordination ONLY (architecture.md §8 flow).
 *
 * Runs the fixed pipeline order repositories → commits → pulls → issues →
 * languages by calling the T2.2 fetchers. It contains NO GitHub API logic
 * itself: every GitHub call stays inside `services/github/*` and flows
 * through the T2.1 rate-limit gate via the injected fetchers.
 *
 * Key behaviors:
 * - Progress (`phase/done/total`) is written per repository unit and is
 *   monotonic (`done` never decreases; `total` refines once, upward only).
 * - Per-repository cursors are checkpointed to SyncState as each repo
 *   completes, so an interrupted run resumes without redoing finished repos.
 * - A failed repository never aborts the other repositories or phases; the
 *   failure is recorded per-resource and the run continues.
 * - Global conditions abort the run but keep prior good state: revoked token
 *   (UNAUTHENTICATED), unresumable rate limit (RATE_LIMITED + resumeAt),
 *   timeout, unexpected errors.
 * - Resume: resources already `done` are skipped only when resuming a
 *   non-succeeded prior run; otherwise every resource re-runs incrementally
 *   from its stored `since`/page cursors (idempotent, no duplicates).
 * - `runSync` resolves with a terminal summary whenever the terminal state
 *   could be persisted; it rejects only when persistence itself failed.
 */

const logger = require('../../utils/logger');
const reposFetcher = require('../github/repos.fetcher');
const commitsFetcher = require('../github/commits.fetcher');
const pullsFetcher = require('../github/pulls.fetcher');
const issuesFetcher = require('../github/issues.fetcher');
const languagesFetcher = require('../github/languages.fetcher');
const persistNamespace = require('../normalization/persist');
const { requestRecompute } = require('../normalization/recompute');
const { createAdapters } = require('./sync.adapters');
const {
  shortMessage,
  abortWith,
  toTerminal,
  rateOrAuthInfo,
  persistAbortState,
  persistResourceFailed,
  runRepositoriesPhase,
  runPerRepoPhase,
} = require('./sync.phases');

const SYNC_TIMEOUT_MS = 15 * 60 * 1000; // architecture.md §8: job timeout 15 min (MVP)
const PHASES = ['repositories', 'commits', 'pulls', 'issues', 'languages'];

const defaultFetchers = {
  fetchRepositories: reposFetcher.fetchRepositories,
  fetchCommitsForRepositories: commitsFetcher.fetchCommitsForRepositories,
  fetchPullRequestsForRepositories: pullsFetcher.fetchPullRequestsForRepositories,
  fetchIssuesForRepositories: issuesFetcher.fetchIssuesForRepositories,
  fetchLanguagesForRepositories: languagesFetcher.fetchLanguagesForRepositories,
};

function timeoutError(timeoutMs) {
  const err = new Error('Sync timed out. Progress was saved; start a new sync to resume.');
  err.code = 'INTERNAL';
  err.retryable = true;
  err.timeout = true;
  err.details = { timeoutMs };
  return err;
}

/**
 * Run the full pipeline for an already-claimed job.
 *
 * Resolves with a terminal summary whenever the terminal state could be
 * persisted. Rejects only when persistence itself failed (store errors) —
 * the background launcher logs that case; nothing is misreported.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {object} opts.userDoc `{ githubTokenEnc }` (memory only, never logged)
 * @param {string} opts.jobId claimed (active) job id
 * @param {object} opts.store persistence primitives (see sync.store.js)
 * @param {object} [opts.fetchers] T2.2 fetchers (defaults to the real ones)
 * @param {string|null} [opts.userLogin] syncing user's login (ownership flags; null → flags false)
 * @param {object} [opts.persist] persistence namespace { persistFetched, loadRepoIdMap } (defaults to normalization/persist)
 * @param {Function} [opts.recompute] recompute trigger (defaults to the T3.2 stub hook)
 * @param {number} [opts.timeoutMs] run deadline (default 15 min; tests inject ms)
 * @param {object} [opts.log] pino-compatible logger
 * @returns {Promise<{ jobId: string, status: string, perResource: object, counts: object }>}
 */
async function runSync(opts = {}) {
  const { userId, userDoc, jobId, store } = opts;
  if (!userId || !userDoc || !jobId || !store) {
    const err = new Error('runSync requires userId, userDoc, jobId, and store.');
    err.code = 'INTERNAL';
    throw err;
  }
  const fetchers = opts.fetchers ?? defaultFetchers;
  const userLogin = opts.userLogin ?? null;
  const persist = opts.persist ?? persistNamespace;
  const recompute = opts.recompute ?? requestRecompute;
  const timeoutMs = Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : SYNC_TIMEOUT_MS;
  const log = opts.log ?? logger;

  const ctx = {
    userId,
    userDoc,
    jobId,
    store,
    fetchers,
    log,
    states: new Map(),
    repos: [],
    repoIdMap: null,
    perResource: {},
    counts: {},
    done: 0,
    total: 1,
    resumeMode: false,
    firstFailureCode: null,
    finished: false,
  };
  const finishOnce = async (patch) => {
    // Set-first (not set-after): a loser pipeline racing a timeout winner
    // must observe the flag synchronously, so two terminal writes can never
    // both be in flight. On write failure the flag re-arms so a retry is
    // still attempted — an unrecorded terminal state must reject, never
    // resolve as if it had been persisted.
    if (ctx.finished) return null;
    ctx.finished = true;
    try {
      return await store.finishJobCAS(jobId, patch);
    } catch (err) {
      ctx.finished = false;
      throw err;
    }
  };
  // Terminal writes must never leak raw driver errors: on failure the run
  // rejects with a typed error, and the log carries safe metadata only
  // (finishErr.message may embed driver/connection details).
  const persistTerminal = async (patch) => {
    try {
      return await finishOnce(patch);
    } catch (finishErr) {
      const code =
        finishErr && typeof finishErr.code === 'string' && finishErr.code.length > 0
          ? finishErr.code
          : 'INTERNAL';
      log.error({ jobId, userId, msg: 'terminal state write failed', code, operation: 'terminal-write' });
      const fatal = new Error('Sync state could not be persisted.');
      fatal.code = 'INTERNAL';
      fatal.retryable = true;
      throw fatal;
    }
  };
  const live =
    (fn) =>
    async (...args) => {
      if (!ctx.finished) await fn(...args);
    };
  ctx.liveSaveProgress = (phase) =>
    live(store.saveProgress.bind(store))(jobId, { phase, done: ctx.done, total: ctx.total });
  ctx.liveSaveState = (resource, patch) => live(store.saveState.bind(store))(userId, resource, patch);
  ctx.checkTimeout = () => {
    if (ctx.timedOut) throw timeoutError(timeoutMs);
  };

  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctx.timedOut = true;
      reject(timeoutError(timeoutMs));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  // T3.2 adapters: each phase fetches through its T2.2 fetcher, then
  // normalizes + persists the DTOs (ctx.persistItems is shared with the
  // repositories phase).
  const { persistItems, adapters } = createAdapters({ ctx, fetchers, persist, userId, userDoc, userLogin });
  ctx.persistItems = persistItems;

  try {
    const summary = await Promise.race([
      (async () => {
        ctx.checkTimeout();
        const prior = await store.getLatestFinishedJob(userId);
        ctx.resumeMode = !!prior && prior.status !== 'succeeded';
        ctx.states = await store.getStates(userId);
        ctx.checkTimeout();
        log.info({ jobId, userId, msg: 'sync started', resumeMode: ctx.resumeMode });
        await ctx.liveSaveProgress('repositories');
        try {
          await runRepositoriesPhase(ctx);
        } catch (err) {
          if (err && (err.code === 'RATE_LIMITED' || err.code === 'UNAUTHENTICATED')) {
            await persistAbortState(ctx, 'repositories', new Map(), new Set(), err);
            abortWith(rateOrAuthInfo(err));
          }
          await persistResourceFailed(
            ctx,
            'repositories',
            new Map(),
            new Set(),
            shortMessage(err && err.message, 'Resource sync failed.')
          );
          abortWith({
            errorCode: typeof err?.code === 'string' && err.code ? err.code : 'INTERNAL',
            message: shortMessage(err && err.message, 'Repository sync failed; nothing downstream can run.'),
            resumeAt: null,
          });
        }
        // Resolve Mongo ids once per run (bounded single query); per-repo
        // phases reuse the map for foreign-key resolution. A load failure
        // aborts: persisting without valid references would corrupt data.
        ctx.repoIdMap = await persist.loadRepoIdMap(
          userId,
          ctx.repos.map((r) => Number(r.repoId))
        );
        for (const resource of ['commits', 'pulls', 'issues', 'languages']) {
          ctx.checkTimeout();
          try {
            await runPerRepoPhase(ctx, resource, adapters[resource]);
          } catch (err) {
            if (err && err.aborted) throw err;
            abortWith(toTerminal(err));
          }
        }
        const failed = Object.values(ctx.perResource).some((s) => s === 'failed');
        if (failed) {
          const names = Object.entries(ctx.perResource)
            .filter(([, s]) => s === 'failed')
            .map(([r]) => r)
            .join(', ');
          return {
            status: 'failed',
            errorCode: ctx.firstFailureCode ?? 'INTERNAL',
            message: shortMessage(`Sync completed with errors in: ${names}.`, 'Sync completed with errors.'),
          };
        }
        return { status: 'succeeded' };
      })(),
      timeoutPromise,
    ]);
    const terminal =
      summary.status === 'succeeded'
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
            error: summary.message,
            errorCode: summary.errorCode,
            resumeAt: null,
          };
    await persistTerminal(terminal);
    if (terminal.status === 'succeeded') {
      try {
        await store.markUserSynced(userId, new Date());
      } catch {
        log.warn({ jobId, userId, code: 'DB_UNAVAILABLE', message: 'lastSyncedAt update skipped' });
      }
    }
    // Recompute trigger hook (T3.2): notify derived-data recomputation only
    // when fresh raw data exists. Best-effort — a hook failure never fails
    // an already-persisted sync.
    if (Object.values(ctx.perResource).includes('done')) {
      try {
        await recompute(userId, { jobId, status: terminal.status });
      } catch (hookErr) {
        const code =
          hookErr && typeof hookErr.code === 'string' && hookErr.code.length > 0 ? hookErr.code : 'INTERNAL';
        log.warn({ jobId, userId, msg: 'recompute trigger skipped', code, operation: 'recompute-trigger' });
      }
    }
    log.info({ jobId, userId, msg: 'sync finished', status: terminal.status });
    return { jobId, status: terminal.status, perResource: ctx.perResource, counts: ctx.counts };
  } catch (err) {
    const terminal = toTerminal(err);
    await persistTerminal({
      status: 'failed',
      perResource: ctx.perResource,
      counts: ctx.counts,
      error: terminal.message,
      errorCode: terminal.errorCode,
      resumeAt: terminal.resumeAt,
    });
    log.warn({ jobId, userId, msg: 'sync aborted', code: terminal.errorCode });
    return { jobId, status: 'failed', perResource: ctx.perResource, counts: ctx.counts };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  runSync,
  PHASES,
  SYNC_TIMEOUT_MS,
};
