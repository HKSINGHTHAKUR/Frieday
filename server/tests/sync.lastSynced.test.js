/**
 * Canonical overall "Last synced" selection (tasks.md T5.3 Settings).
 *
 * The top-level Settings "Last synced" must reflect the most recent
 * successful SyncState resource sync (architecture.md §15), so a webhook/
 * incremental update is never hidden behind the older User.lastSyncedAt
 * full-resync marker. A resource's lastSyncedAt only advances on a
 * successful persist, so a failed sync never becomes "last successful".
 *
 * DB-free: overallLastSyncedAt is pure; getLastSyncedAt accepts an
 * injectable model.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { overallLastSyncedAt, getLastSyncedAt } = require('../src/services/sync/sync.store');

function at(iso) {
  return new Date(iso);
}

function fakeModel(states, calls) {
  return {
    find(filter) {
      if (calls) calls.push(filter);
      return {
        select: () => ({
          lean: () => ({
            exec: async () => states,
          }),
        }),
      };
    },
  };
}

describe('overallLastSyncedAt (pure selection)', () => {
  it('D: returns null when nothing has ever synced (no states)', () => {
    assert.equal(overallLastSyncedAt([]), null);
  });

  it('D: returns null when every resource is null', () => {
    assert.equal(overallLastSyncedAt([{ lastSyncedAt: null }, { lastSyncedAt: null }]), null);
  });

  it('A: selects the most recent resource timestamp as the overall value', () => {
    const result = overallLastSyncedAt([
      { lastSyncedAt: at('2026-10-05T10:00:00Z') },
      { lastSyncedAt: at('2026-10-06T08:00:00Z') },
      { lastSyncedAt: at('2026-10-04T12:00:00Z') },
    ]);
    assert.equal(result.toISOString(), '2026-10-06T08:00:00.000Z');
  });

  it('B: a newer resource timestamp cannot make the overall value appear older', () => {
    // Repo resources full-synced 14h ago, but an incremental resource sync
    // happened 5h ago — the overall value must reflect the newer one.
    const result = overallLastSyncedAt([
      { lastSyncedAt: at('2026-10-05T10:00:00Z') }, // older full-sync marker
      { lastSyncedAt: at('2026-10-06T09:00:00Z') }, // newer incremental sync
    ]);
    assert.equal(result.toISOString(), '2026-10-06T09:00:00.000Z');
  });

  it('C: a failed resource (older/null stamp) never becomes "last successful"', () => {
    // Failed resources keep their prior lastSyncedAt (or null); only a newer
    // successful stamp advances the overall value.
    const result = overallLastSyncedAt([
      { lastSyncedAt: at('2026-10-04T08:00:00Z') }, // failed resource, old stamp
      { lastSyncedAt: null }, // another failed resource, never stamped
      { lastSyncedAt: at('2026-10-06T09:00:00Z') }, // successful resource
    ]);
    assert.equal(result.toISOString(), '2026-10-06T09:00:00.000Z');
  });
});

describe('getLastSyncedAt (SyncState-backed, injected model)', () => {
  it('A/B: returns the max resource timestamp from SyncState', async () => {
    const states = [
      { lastSyncedAt: at('2026-10-05T10:00:00Z') },
      { lastSyncedAt: at('2026-10-06T09:00:00Z') },
    ];
    const result = await getLastSyncedAt('user-1', { model: fakeModel(states) });
    assert.equal(result.toISOString(), '2026-10-06T09:00:00.000Z');
  });

  it('D: returns null when no resource has synced', async () => {
    const result = await getLastSyncedAt('user-1', {
      model: fakeModel([{ lastSyncedAt: null }, { lastSyncedAt: null }]),
    });
    assert.equal(result, null);
  });

  it('is scoped to the requesting user', async () => {
    const calls = [];
    await getLastSyncedAt('user-scoped-9', { model: fakeModel([], calls) });
    assert.deepEqual(calls, [{ userId: 'user-scoped-9' }]);
  });
});
