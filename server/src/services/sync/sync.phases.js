/**
 * Sync phase runners (T2.3) — the per-resource pipeline steps.
 *
 * `runRepositoriesPhase` always refetches the roster (cheap, and it picks up
 * repositories created since any prior run). `runPerRepoPhase` drives one
 * T2.2 multi-fetcher with per-repository cursors, per-repo progress writes,
 * and per-repo cursor checkpoints, so an interrupted run resumes without
 * redoing finished repositories. No GitHub code lives here: all fetching
 * goes through the injected T2.2 fetchers.
 */

const ERROR_MAX = 200; // SyncState/SyncJob `error` maxlength

function shortMessage(value, fallback) {
  const text = typeof value === 'string' && value.length > 0 ? value : fallback;
  return String(text).slice(0, ERROR_MAX);
}

/** Control-flow error: abort the run with already-mapped terminal info. */
class AbortRun extends Error {
  constructor(info) {
    super(info.message);
    this.name = 'AbortRun';
    this.aborted = true;
    this.info = info;
  }
}

function abortWith(info) {
  throw new AbortRun(info);
}

function repoKey(owner, name) {
  return `${owner}/${name}`;
}

/**
 * Read a per-repo checkpoint envelope `{ repos, completed }` defensively:
 * malformed cursors (wrong types, arrays, nulls) fall back to empty, which
 * simply means "fetch everything" — never a crash.
 */
function readEnvelope(cursor) {
  const repos =
    cursor &&
    typeof cursor === 'object' &&
    !Array.isArray(cursor) &&
    cursor.repos &&
    typeof cursor.repos === 'object' &&
    !Array.isArray(cursor.repos)
      ? cursor.repos
      : {};
  const completed = Array.isArray(cursor?.completed)
    ? cursor.completed.filter((k) => typeof k === 'string')
    : [];
  return { repos, completed: new Set(completed) };
}

function summarizeErrors(errors) {
  const entries = [...errors.entries()].slice(0, 3);
  const parts = entries.map(([key, info]) => `${key} (${info?.code ?? 'UNKNOWN'})`);
  const suffix = errors.size > 3 ? `, +${errors.size - 3} more` : '';
  return `${errors.size} repositories failed: ${parts.join(', ')}${suffix}`;
}

/**
 * Map a run-ending failure to persisted terminal info. Only errors whose
 * code is a string (envelope codes from our own layers — verified to carry
 * no secrets) keep their message; anything else (driver errors, TypeErrors)
 * is replaced with a generic message so Mongo details or stacks never reach
 * the database or the client.
 */
function toTerminal(err) {
  if (err && err.aborted) return err.info;
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
  if (err && err.timeout) {
    return { errorCode: 'INTERNAL', message: shortMessage(err.message, 'Sync timed out.'), resumeAt: null };
  }
  if (err && typeof err.code === 'string' && err.code.length > 0) {
    return { errorCode: err.code, message: shortMessage(err.message, 'Sync failed.'), resumeAt: null };
  }
  return {
    errorCode: 'INTERNAL',
    message: 'Sync failed unexpectedly. Progress was saved; start a new sync to resume.',
    resumeAt: null,
  };
}

function rateOrAuthInfo(err) {
  if (err && err.code === 'RATE_LIMITED') {
    return {
      errorCode: 'RATE_LIMITED',
      message: shortMessage(err.message, 'GitHub rate limit reached.'),
      resumeAt: err.resumeAt instanceof Date ? err.resumeAt : null,
    };
  }
  return {
    errorCode: 'UNAUTHENTICATED',
    message: shortMessage(err && err.message, 'GitHub connection expired.'),
    resumeAt: null,
  };
}

async function persistAbortState(ctx, resource, repoCursors, completed, err) {
  const status = err && err.code === 'RATE_LIMITED' ? 'rate_limited' : 'failed';
  await ctx.liveSaveState(resource, {
    status,
    cursor: { repos: Object.fromEntries(repoCursors), completed: [...completed] },
    error: shortMessage(err && err.message, 'Sync aborted.'),
  });
}

async function persistResourceFailed(ctx, resource, repoCursors, completed, message, code) {
  if (!ctx.firstFailureCode) ctx.firstFailureCode = code ?? 'INTERNAL';
  await ctx.liveSaveState(resource, {
    status: 'failed',
    cursor: { repos: Object.fromEntries(repoCursors), completed: [...completed] },
    error: message,
  });
  ctx.perResource[resource] = 'failed';
}

async function runRepositoriesPhase(ctx) {
  const out = await ctx.fetchers.fetchRepositories(ctx.userDoc, {});
  if (!out || !Array.isArray(out.repos)) {
    const err = new Error('Malformed fetcher output (repositories).');
    err.code = 'INTERNAL';
    err.retryable = false;
    throw err;
  }
  const repos = [];
  let dropped = 0;
  for (const raw of out.repos) {
    if (
      raw &&
      typeof raw.owner === 'string' &&
      typeof raw.name === 'string' &&
      raw.githubId !== undefined &&
      raw.githubId !== null
    ) {
      repos.push({ owner: raw.owner, name: raw.name, repoId: String(raw.githubId) });
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    ctx.log.warn({ jobId: ctx.jobId, userId: ctx.userId, msg: 'roster entries skipped', dropped });
  }
  // Persist before any downstream phase resolves Mongo ids from it. Any
  // invalid row or write failure aborts the run: downstream identity mapping
  // is unsafe on a corrupt roster.
  const persisted = await ctx.persistItems('repositories', out.repos);
  if (persisted.invalid.length > 0 || persisted.writeErrors.length > 0) {
    const first = persisted.invalid[0] ?? persisted.writeErrors[0];
    const message = shortMessage(`Repository sync failed: ${first.message}`, 'Repository sync failed.');
    await ctx.liveSaveState('repositories', { status: 'failed', cursor: null, error: message });
    ctx.perResource.repositories = 'failed';
    ctx.counts.repositories = persisted.count;
    abortWith({ errorCode: (first && first.code) || 'INTERNAL', message, resumeAt: null });
  }
  ctx.repos = repos;
  ctx.counts.repositories = persisted.count;
  ctx.perResource.repositories = 'done';
  ctx.done = 1;
  ctx.total = 1 + 4 * repos.length;
  await ctx.liveSaveState('repositories', {
    status: 'done',
    cursor: null,
    error: null,
    lastSyncedAt: new Date(),
  });
  await ctx.liveSaveProgress('repositories');
}

/**
 * Generic per-repository phase (commits/pulls/issues/languages).
 * `run` adapts one T2.2 multi-fetcher to `{ count, cursors, errors }`.
 * Resources already `done` are skipped only in resume mode; otherwise every
 * resource re-runs incrementally from its stored cursors (idempotent, no
 * duplicates). Throws AbortRun for run-ending conditions (rate limit, dead
 * token); records resource-level failures and returns for anything else.
 */
async function runPerRepoPhase(ctx, resource, run) {
  const state = ctx.states.get(resource);
  if (ctx.resumeMode && state && state.status === 'done') {
    ctx.perResource[resource] = 'skipped';
    ctx.counts[resource] = 0;
    ctx.done += ctx.repos.length;
    await ctx.liveSaveProgress(resource);
    ctx.log.info({
      jobId: ctx.jobId,
      userId: ctx.userId,
      msg: 'resource skipped (already current)',
      resource,
    });
    return;
  }
  const prior = readEnvelope(state ? state.cursor : null);
  const repoCursors = new Map(Object.entries(prior.repos));
  const completed = new Set(prior.completed);
  const todo = ctx.repos.filter((r) => !completed.has(repoKey(r.owner, r.name)));
  const base = ctx.done;
  const checkpoint = async ({ key, cursor }) => {
    ctx.done += 1;
    if (cursor !== undefined && cursor !== null) repoCursors.set(key, cursor);
    completed.add(key);
    await ctx.liveSaveProgress(resource);
    await ctx.liveSaveState(resource, { repos: Object.fromEntries(repoCursors), completed: [...completed] });
  };
  let out;
  try {
    out = await run(todo, repoCursors, checkpoint);
    if (
      !out ||
      typeof out.count !== 'number' ||
      !(out.cursors instanceof Map) ||
      !(out.errors instanceof Map)
    ) {
      const malformed = new Error(`Malformed fetcher output (${resource}).`);
      malformed.code = 'INTERNAL';
      malformed.retryable = false;
      throw malformed;
    }
  } catch (err) {
    if (err && (err.code === 'RATE_LIMITED' || err.code === 'UNAUTHENTICATED')) {
      await persistAbortState(ctx, resource, repoCursors, completed, err);
      abortWith(rateOrAuthInfo(err));
    }
    const code = typeof err?.code === 'string' && err.code ? err.code : 'INTERNAL';
    const message = code === 'INTERNAL' && !err?.code ? 'Resource sync failed.' : err?.message;
    await persistResourceFailed(
      ctx,
      resource,
      repoCursors,
      completed,
      shortMessage(message, 'Resource sync failed.'),
      code
    );
    ctx.done = Math.max(ctx.done, base + ctx.repos.length);
    await ctx.liveSaveProgress(resource);
    ctx.log.warn({
      jobId: ctx.jobId,
      userId: ctx.userId,
      msg: 'resource failed, continuing',
      resource,
      code,
    });
    return;
  }
  for (const [key, cursor] of out.cursors) {
    repoCursors.set(key, cursor);
    completed.add(key);
  }
  const rateEntry = firstErrorWithCode(out.errors, 'RATE_LIMITED');
  if (rateEntry) {
    await persistAbortState(ctx, resource, repoCursors, completed, rateEntry[1]);
    abortWith(rateOrAuthInfo(rateEntry[1]));
  }
  const authEntry = firstErrorWithCode(out.errors, 'UNAUTHENTICATED');
  if (authEntry) {
    await persistResourceFailed(
      ctx,
      resource,
      repoCursors,
      completed,
      shortMessage(authEntry[1].message, 'GitHub connection expired.'),
      'UNAUTHENTICATED'
    );
    abortWith({
      errorCode: 'UNAUTHENTICATED',
      message: shortMessage(authEntry[1].message, 'GitHub connection expired.'),
      resumeAt: null,
    });
  }
  ctx.counts[resource] = out.count;
  if (out.errors.size > 0) {
    const first = [...out.errors.values()][0];
    const code = first && typeof first.code === 'string' && first.code ? first.code : 'INTERNAL';
    await persistResourceFailed(
      ctx,
      resource,
      repoCursors,
      completed,
      shortMessage(summarizeErrors(out.errors), 'Resource sync failed.'),
      code
    );
    ctx.perResource[resource] = 'failed';
  } else {
    ctx.perResource[resource] = 'done';
    await ctx.liveSaveState(resource, {
      status: 'done',
      cursor: { repos: Object.fromEntries(repoCursors), completed: [...completed] },
      error: null,
      lastSyncedAt: new Date(),
    });
  }
  ctx.done = Math.max(ctx.done, base + ctx.repos.length);
  await ctx.liveSaveProgress(resource);
}

function firstErrorWithCode(errors, code) {
  for (const entry of errors.entries()) {
    if (entry[1] && entry[1].code === code) return entry;
  }
  return null;
}

module.exports = {
  ERROR_MAX,
  shortMessage,
  AbortRun,
  abortWith,
  toTerminal,
  repoKey,
  readEnvelope,
  summarizeErrors,
  rateOrAuthInfo,
  persistAbortState,
  persistResourceFailed,
  runRepositoriesPhase,
  runPerRepoPhase,
  firstErrorWithCode,
};
