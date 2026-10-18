/**
 * In-memory fake of the sync store interface (see services/sync/sync.store.js).
 *
 * Mirrors the Mongoose shapes exactly (plain objects, `id` strings, Maps for
 * states) so orchestrator/service logic is tested without MongoDB. The
 * single-flight claim mirrors the partial unique index: `createJob` checks
 * and sets with no interleaving await, so concurrent claims resolve exactly
 * like a duplicate-key error (code 11000) would against MongoDB.
 *
 * `failMethods` (e.g. `['saveProgress']`) makes those primitives throw a
 * driver-shaped error (no envelope code) to simulate a dead database.
 */

const ACTIVE = ['queued', 'running'];

function isActive(job) {
  return !!job && ACTIVE.includes(job.status);
}

function createFakeStore({ failMethods = [] } = {}) {
  const fail = new Set(failMethods);
  const jobs = new Map(); // id -> job
  const states = new Map(); // `${userId}:${resource}` -> state
  const progressLog = []; // [{ jobId, progress }] in write order
  const syncedUsers = []; // [{ userId, date }] in call order
  const repoSynced = []; // [{ userId, githubId, date }] in call order
  let seq = 0;

  const maybeFail = (name) => {
    if (fail.has(name)) {
      const err = new Error(`fake store failure (${name})`);
      throw err;
    }
  };

  return {
    progressLog,
    syncedUsers,
    repoSynced,
    _jobs: jobs,
    _states: states,

    async findActiveJob(userId) {
      maybeFail('findActiveJob');
      const found = [...jobs.values()]
        .filter((j) => String(j.userId) === String(userId) && isActive(j))
        .sort((a, b) => b.seq - a.seq)[0];
      return found ? { ...found } : null;
    },

    async createJob({ userId, kind, progress, startedAt }) {
      maybeFail('createJob');
      // Atomic mirror of the partial unique index (no await between check
      // and set, so concurrent claims serialize exactly like E11000).
      if ([...jobs.values()].some((j) => String(j.userId) === String(userId) && isActive(j))) {
        const err = new Error('E11000 duplicate key (fake single-flight)');
        err.code = 11000;
        throw err;
      }
      seq += 1;
      const job = {
        id: `job-${seq}`,
        seq,
        userId,
        kind,
        status: 'running',
        progress: progress ? { ...progress } : { phase: 'repositories', done: 0, total: 1 },
        perResource: null,
        counts: null,
        startedAt: startedAt ?? new Date(),
        finishedAt: null,
        error: null,
        errorCode: null,
        resumeAt: null,
        createdAt: new Date(),
      };
      jobs.set(job.id, job);
      return { ...job };
    },

    async finishJobCAS(jobId, patch) {
      maybeFail('finishJobCAS');
      const job = jobs.get(jobId);
      if (!job || !isActive(job)) return null;
      Object.assign(job, patch, { finishedAt: new Date() });
      return { ...job };
    },

    async getLatestJob(userId) {
      maybeFail('getLatestJob');
      const found = [...jobs.values()]
        .filter((j) => String(j.userId) === String(userId))
        .sort((a, b) => b.seq - a.seq)[0];
      return found ? { ...found } : null;
    },

    async getLatestFinishedJob(userId) {
      maybeFail('getLatestFinishedJob');
      const found = [...jobs.values()]
        .filter((j) => String(j.userId) === String(userId) && !isActive(j))
        .sort((a, b) => b.seq - a.seq)[0];
      return found ? { ...found } : null;
    },

    async listHistory(userId, limit = 20) {
      maybeFail('listHistory');
      return [...jobs.values()]
        .filter((j) => String(j.userId) === String(userId))
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit)
        .map((j) => ({ ...j }));
    },

    async countJobs(userId) {
      maybeFail('countJobs');
      return [...jobs.values()].filter((j) => String(j.userId) === String(userId)).length;
    },

    async deleteJobsExcept(userId, keepIds) {
      maybeFail('deleteJobsExcept');
      const keep = new Set((keepIds ?? []).map(String));
      let dropped = 0;
      for (const [id, job] of jobs) {
        if (String(job.userId) === String(userId) && !keep.has(String(id))) {
          jobs.delete(id);
          dropped += 1;
        }
      }
      return dropped;
    },

    async getStates(userId) {
      maybeFail('getStates');
      const map = new Map();
      for (const [key, state] of states) {
        if (key.startsWith(`${userId}:`)) map.set(state.resource, { ...state });
      }
      return map;
    },

    async saveState(userId, resource, patch) {
      maybeFail('saveState');
      const key = `${userId}:${resource}`;
      const prev = states.get(key) ?? {
        resource,
        status: 'idle',
        lastSyncedAt: null,
        cursor: null,
        error: null,
      };
      states.set(key, { ...prev, ...patch });
    },

    async saveProgress(jobId, progress) {
      maybeFail('saveProgress');
      const job = jobs.get(jobId);
      if (job) job.progress = { ...progress };
      progressLog.push({ jobId, progress: { ...progress } });
    },

    async markUserSynced(userId, date) {
      maybeFail('markUserSynced');
      syncedUsers.push({ userId, date: date ?? new Date() });
    },

    async markRepoSynced(userId, githubId, date) {
      maybeFail('markRepoSynced');
      repoSynced.push({ userId, githubId, date: date ?? new Date() });
    },

    /** Test-only: insert an arbitrary job shape (e.g. stale running jobs). */
    __seedJob(doc) {
      seq += 1;
      const job = {
        id: doc.id ?? `job-${seq}`,
        seq,
        userId: doc.userId,
        kind: doc.kind ?? 'initial',
        status: doc.status ?? 'running',
        progress: doc.progress ?? { phase: 'repositories', done: 0, total: 1 },
        perResource: doc.perResource ?? null,
        counts: doc.counts ?? null,
        startedAt: doc.startedAt ?? new Date(),
        finishedAt: doc.finishedAt ?? null,
        error: doc.error ?? null,
        errorCode: doc.errorCode ?? null,
        resumeAt: doc.resumeAt ?? null,
        createdAt: doc.createdAt ?? new Date(),
      };
      jobs.set(job.id, job);
      return { ...job };
    },
  };
}

module.exports = { createFakeStore };
