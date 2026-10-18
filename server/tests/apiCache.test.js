/**
 * apiCache scope separation (T5.1).
 *
 * The dashboard and insights routes cache different-shaped values for the
 * same (userId, range, lastSyncedAt). A shared keyspace made them collide:
 * the insights response could serve the dashboard's cached payload (no
 * generatedAt / no id) and vice-versa. Each route now passes an entity scope,
 * so the key is `${scope}:${userId}:${range}:${granularity}:${lastSyncedAt}`.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const apiCache = require('../src/utils/apiCache');

function freshUser() {
  return 'u-' + Math.random().toString(36).slice(2, 10);
}

describe('apiCache scope separation', () => {
  it('dashboard and insights never collide for the same user/range/lastSyncedAt', () => {
    const userId = freshUser();
    const t = '2026-10-06T00:00:00.000Z';
    apiCache.set('dashboard', userId, '30d', t, { kpis: { totalCommits: 121 }, buckets: [] });
    assert.equal(
      apiCache.get('insights', userId, '30d', t),
      null,
      'insights must not see the dashboard entry'
    );
    const dash = apiCache.get('dashboard', userId, '30d', t);
    assert.equal(dash.kpis.totalCommits, 121);

    apiCache.set('insights', userId, '30d', t, {
      insights: [{ id: 'x', generatedAt: '2026-10-06T12:00:00Z' }],
    });
    const dashAgain = apiCache.get('dashboard', userId, '30d', t);
    assert.equal(dashAgain.kpis.totalCommits, 121, 'dashboard entry is not overwritten by insights');
    const ins = apiCache.get('insights', userId, '30d', t);
    assert.equal(ins.insights[0].generatedAt, '2026-10-06T12:00:00Z');
  });

  it('timeline granularity dimension is preserved within its own scope', () => {
    const userId = freshUser();
    const t = '2026-10-06T00:00:00.000Z';
    apiCache.set('timeline', userId, '30d', t, { buckets: ['day'] }, 'day');
    apiCache.set('timeline', userId, '30d', t, { buckets: ['week'] }, 'week');
    assert.equal(apiCache.get('timeline', userId, '30d', t, 'day').buckets[0], 'day');
    assert.equal(apiCache.get('timeline', userId, '30d', t, 'week').buckets[0], 'week');
    assert.equal(apiCache.get('insights', userId, '30d', t), null);
  });

  it('invalidateUser clears only the target user across scopes', () => {
    const userA = freshUser();
    const userB = freshUser();
    const t = '2026-10-06T00:00:00.000Z';
    apiCache.set('insights', userA, '30d', t, { insights: [{ id: 'a' }] });
    apiCache.set('insights', userB, '30d', t, { insights: [{ id: 'b' }] });
    apiCache.invalidateUser(userA);
    assert.equal(apiCache.get('insights', userA, '30d', t), null);
    assert.ok(apiCache.get('insights', userB, '30d', t), 'other user untouched');
  });
});
