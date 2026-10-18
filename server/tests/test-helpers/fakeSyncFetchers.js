/**
 * Scripted fake T2.2 fetchers for T2.3 tests (no live GitHub, no real time).
 *
 * `behaviors[resource]` controls each phase:
 * - undefined → success (`perRepo` items per repo, cursor `{ page: 2 }`)
 * - `{ throw: err }` → the fetcher rejects (list-level failure path)
 * - `{ defer }` → awaits `defer.promise` first (timeout/active-state tests)
 * - `{ failKeys: Map(key -> { message, code, ... }) }` → those repos land in
 *   the per-repo errors map while the rest succeed (partial failure)
 * - `{ raw: value }` (repositories only) → returned verbatim, bypassing all
 *   shaping (malformed-output tests)
 *
 * Every invocation is recorded in `log` as `{ resource, repos, cursorKeys }`
 * so tests can assert call order, per-repo targeting, and cursor reuse.
 */

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createScriptedFetchers({ repos = [], behaviors = {}, log = [] } = {}) {
  async function runList(resource, itemKey, repoList, opts = {}) {
    log.push({
      resource,
      repos: repoList.map((r) => `${r.owner}/${r.name}`),
      cursorKeys: [...((opts && opts.cursors) || new Map()).keys()],
    });
    const behavior = behaviors[resource] ?? {};
    if (behavior.defer) await behavior.defer.promise;
    if (behavior.throw) throw behavior.throw;
    const failKeys = behavior.failKeys ?? new Map();
    const perRepo = behavior.perRepo ?? 2;
    const items = [];
    const cursors = new Map();
    const errors = new Map();
    let index = 0;
    for (const repo of repoList) {
      const key = `${repo.owner}/${repo.name}`;
      // Todos carry the T2.2 contract shape `{ owner, name, repoId }` where
      // `repoId` is the GitHub repository id (string or number).
      const githubId = Number(repo.repoId);
      if (!Number.isInteger(githubId) || githubId <= 0) {
        throw new Error(`Invalid repoId for repo ${repo.owner}/${repo.name}: ${repo.repoId}`);
      }
      if (failKeys.has(key)) {
        errors.set(key, failKeys.get(key));
      } else {
        for (let i = 0; i < perRepo; i++) items.push({ repo, repoId: githubId, i });
        const cursor = { page: 2 };
        cursors.set(key, cursor);
        if (opts && typeof opts.onProgress === 'function') {
          await opts.onProgress({ key, index, total: repoList.length, cursor });
        }
      }
      index += 1;
    }
    return { [itemKey]: items, cursors, capReached: false, errors };
  }

  return {
    log,
    async fetchRepositories(_userDoc, _opts = {}) {
      log.push({ resource: 'repositories', repos: [] });
      const behavior = behaviors.repositories ?? {};
      if (behavior.defer) await behavior.defer.promise;
      if (behavior.throw) throw behavior.throw;
      if (behavior.raw !== undefined) return behavior.raw;
      return { repos, cursor: null, capReached: false, notModified: false };
    },
    async fetchCommitsForRepositories(userDoc, repoList, opts = {}) {
      const out = await runList('commits', 'commits', repoList, opts);
      return { commits: out.commits, cursors: out.cursors, capReached: out.capReached, errors: out.errors };
    },
    async fetchPullRequestsForRepositories(userDoc, repoList, opts = {}) {
      const out = await runList('pulls', 'prs', repoList, opts);
      return { prs: out.prs, cursors: out.cursors, capReached: out.capReached, errors: out.errors };
    },
    async fetchIssuesForRepositories(userDoc, repoList, opts = {}) {
      const out = await runList('issues', 'issues', repoList, opts);
      return { issues: out.issues, cursors: out.cursors, capReached: out.capReached, errors: out.errors };
    },
    async fetchLanguagesForRepositories(userDoc, repoList, opts = {}) {
      const out = await runList('languages', 'languageSnapshots', repoList, opts);
      return { languageSnapshots: out.languageSnapshots, errors: out.errors };
    },
  };
}

module.exports = { createScriptedFetchers, deferred };
