/**
 * Fake persistence namespace for T3.2 wiring tests (no MongoDB).
 *
 * Mirrors `services/normalization/persist.js` (`persistFetched` +
 * `loadRepoIdMap`): records every call and reports all DTOs as persisted
 * with no failures, so orchestrator/service/route tests exercise the real
 * wiring without a database. Real bulk semantics are covered by
 * persist.test.js (fake models + DB-gated real Mongo).
 */

function createFakePersist({ calls = [], persistedPerCall } = {}) {
  return {
    calls,
    async persistFetched(userId, resource, dtos, opts = {}) {
      calls.push({
        op: 'persistFetched',
        resource,
        count: (dtos ?? []).length,
        userLogin: opts.userLogin ?? null,
      });
      const count =
        typeof persistedPerCall === 'function' ? persistedPerCall(resource, dtos) : (dtos ?? []).length;
      return { persisted: count, invalid: [], writeErrors: [] };
    },
    async loadRepoIdMap(userId, githubIds) {
      calls.push({ op: 'loadRepoIdMap', count: (githubIds ?? []).length });
      const map = new Map();
      for (const id of githubIds ?? []) {
        if (Number.isInteger(id)) map.set(id, new (require('mongoose').Types.ObjectId)());
      }
      return map;
    },
  };
}

module.exports = { createFakePersist };
