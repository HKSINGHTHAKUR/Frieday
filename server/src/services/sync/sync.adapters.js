/**
 * Phase adapters (T3.2) — adapt each T2.2 multi-fetcher to the orchestrator's
 * `{ count, cursors, capReached, errors }` phase contract.
 *
 * Every adapter fetches through the injected fetchers, then normalizes +
 * persists the fetched DTOs through the injected persistence namespace
 * (`persistFetched`). Persist failures merge into the fetcher's per-repo
 * error map so triage sees one map; counts reflect persisted records
 * (invalid DTOs never count as synced). `persistItems` is also used by the
 * repositories phase (shared via ctx).
 */

// One row per resource: the T2.2 multi-fetcher to call, the DTO list key in
// its result, and whether the fetcher reports per-repo cursors (languages is
// a per-repo endpoint with no pagination).
const FETCHERS = {
  commits: { fn: 'fetchCommitsForRepositories', list: 'commits', noCursors: false },
  pulls: { fn: 'fetchPullRequestsForRepositories', list: 'prs', noCursors: false },
  issues: { fn: 'fetchIssuesForRepositories', list: 'issues', noCursors: false },
  languages: { fn: 'fetchLanguagesForRepositories', list: 'languageSnapshots', noCursors: true },
};

function malformedOutput(resource) {
  const err = new Error(`Malformed fetcher output (${resource}).`);
  err.code = 'INTERNAL';
  err.retryable = false;
  return err;
}

/**
 * Normalize + persist one phase's DTOs; invalid DTOs and write failures
 * merge into the given base error map so triage sees a single map. Counts
 * reflect persisted records (invalid DTOs never count as synced).
 */
async function persistItems({ ctx, persist, userId, userLogin }, resource, items, baseErrors = new Map()) {
  const persisted = await persist.persistFetched(userId, resource, items, {
    userLogin,
    repoIdMap: ctx.repoIdMap,
  });
  const errors = new Map(baseErrors);
  for (const inv of persisted.invalid)
    errors.set(inv.key, { message: inv.message, code: 'VALIDATION_ERROR' });
  for (const w of persisted.writeErrors) errors.set(w.key, { message: w.message, code: w.code });
  return {
    count: persisted.persisted,
    errors,
    invalid: persisted.invalid,
    writeErrors: persisted.writeErrors,
  };
}

function makeAdapter(resource, fetchers, deps) {
  const { fn, list, noCursors } = FETCHERS[resource];
  return (todos, cursors, onProgress) =>
    fetchers[fn](deps.userDoc, todos, { cursors, onProgress }).then(async (r) => {
      const shaped = r && Array.isArray(r[list]) && r.errors instanceof Map;
      if (!shaped || (!noCursors && !(r.cursors instanceof Map))) throw malformedOutput(resource);
      const p = await persistItems(deps, resource, r[list], r.errors);
      return {
        count: p.count,
        cursors: noCursors ? new Map() : r.cursors,
        capReached: noCursors ? false : r.capReached,
        errors: p.errors,
      };
    });
}

function createAdapters({ ctx, fetchers, persist, userId, userDoc, userLogin }) {
  const deps = { ctx, persist, userId, userDoc, userLogin };
  const adapters = {};
  for (const resource of Object.keys(FETCHERS)) adapters[resource] = makeAdapter(resource, fetchers, deps);
  return {
    persistItems: (resource, items, baseErrors) => persistItems(deps, resource, items, baseErrors),
    adapters,
  };
}

module.exports = { createAdapters };
