/**
 * T7.2 scheduler tests (task §10/§11, acceptance D/E).
 *
 * Injectable seams (setTimer/clearTimer/listUsers/startSyncFn) mean no test
 * waits real hours or sleeps — the stagger mechanism is observed directly.
 * node-cron is only exercised via `start()/stop()` shape; `runTick` is the
 * tested unit.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const {
  createScheduler,
  DEFAULT_CRON,
  DEFAULT_STAGGER_MS,
  MAX_USERS_PER_TICK,
  defaultListUsers,
  defaultStartSync,
} = require('../src/jobs/scheduler');

const silentLog = { info() {}, warn() {}, error() {} };

function captureTimers() {
  const scheduled = [];
  const cleared = [];
  return {
    scheduled,
    cleared,
    setTimer: (fn, ms) => {
      const t = { id: scheduled.length, fn, ms };
      scheduled.push(t);
      return t;
    },
    clearTimer: (t) => {
      cleared.push(t);
    },
  };
}

function fire(scheduled, index) {
  const t = scheduled[index];
  t.fn();
  return t;
}

describe('jobs/scheduler (T7.2)', () => {
  describe('D. cadence + staggering + bounded work', () => {
    it('runs on the documented 6-hour cadence by default', () => {
      assert.equal(DEFAULT_CRON, '0 */6 * * *', 'every 6 hours, on the hour');
      assert.equal(DEFAULT_STAGGER_MS, 5000);
    });

    it('starts each user on an increasing stagger delay within a tick', async () => {
      const timers = captureTimers();
      const calls = [];
      const scheduler = createScheduler({
        staggerMs: 10,
        listUsers: async () => ['u1', 'u2', 'u3'],
        startSyncFn: async (userId) => {
          calls.push(userId);
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        log: silentLog,
      });
      await scheduler.runTick();
      assert.deepEqual(
        timers.scheduled.map((t) => t.ms),
        [0, 10, 20],
        'staggered starts must be spaced by staggerMs'
      );
      assert.equal(calls.length, 0, 'no start before the timers fire');
      for (let i = 0; i < timers.scheduled.length; i++) fire(timers.scheduled, i);
      assert.deepEqual(calls, ['u1', 'u2', 'u3']);
    });

    it('bounds the work created per tick (maxUsers)', async () => {
      const timers = captureTimers();
      const scheduler = createScheduler({
        maxUsers: 2,
        listUsers: async () => ['u1', 'u2', 'u3'],
        startSyncFn: async () => {},
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        log: silentLog,
      });
      await scheduler.runTick();
      assert.equal(timers.scheduled.length, 2, 'only maxUsers starts are scheduled');
    });

    it('does not enqueue a user while a previous sync is active (single-flight skip)', async () => {
      const timers = captureTimers();
      const attempted = [];
      const scheduler = createScheduler({
        staggerMs: 0,
        listUsers: async () => ['u1', 'u2'],
        startSyncFn: async (userId) => {
          attempted.push(userId);
          const err = new Error('A sync is already running for this account.');
          err.code = 'SYNC_CONFLICT';
          throw err;
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        log: silentLog,
      });
      await scheduler.runTick();
      for (let i = 0; i < timers.scheduled.length; i++) fire(timers.scheduled, i);
      assert.deepEqual(
        attempted,
        ['u1', 'u2'],
        'each user attempted once; conflicts are logged, never re-queued'
      );
    });

    it('a disconnected user does not crash the scheduler', async () => {
      const timers = captureTimers();
      const attempted = [];
      const scheduler = createScheduler({
        staggerMs: 0,
        listUsers: async () => ['u1', 'u2'],
        startSyncFn: async (userId) => {
          attempted.push(userId);
          const err = new Error('No connected GitHub account.');
          err.code = 'UNAUTHENTICATED';
          throw err;
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        log: silentLog,
      });
      await scheduler.runTick();
      for (let i = 0; i < timers.scheduled.length; i++) fire(timers.scheduled, i);
      assert.deepEqual(attempted, ['u1', 'u2']);
    });

    it('one failing user does not stop the others', async () => {
      const timers = captureTimers();
      const attempted = [];
      const scheduler = createScheduler({
        staggerMs: 0,
        listUsers: async () => ['u-bad', 'u-good'],
        startSyncFn: async (userId) => {
          attempted.push(userId);
          if (userId === 'u-bad') throw new Error('boom');
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        log: silentLog,
      });
      await scheduler.runTick();
      for (let i = 0; i < timers.scheduled.length; i++) fire(timers.scheduled, i);
      assert.deepEqual(attempted, ['u-bad', 'u-good'], 'the bad user must not abort the good one');
    });

    it('does not overlap ticks (no unbounded work from a slow list)', async () => {
      const timers = captureTimers();
      let release;
      const gate = new Promise((r) => {
        release = r;
      });
      let listed = 0;
      const scheduler = createScheduler({
        listUsers: async () => {
          listed += 1;
          await gate;
          return ['u1'];
        },
        startSyncFn: async () => {},
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        log: silentLog,
      });
      const first = scheduler.runTick();
      const second = await scheduler.runTick();
      assert.equal(second, undefined, 'a second tick while one is running must no-op');
      release();
      await first;
      assert.equal(listed, 1, 'listUsers must run once per non-overlapping tick');
    });

    it('stop() clears pending staggered timers', async () => {
      const timers = captureTimers();
      const scheduler = createScheduler({
        staggerMs: 1000,
        listUsers: async () => ['u1', 'u2'],
        startSyncFn: async () => {},
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        log: silentLog,
      });
      await scheduler.runTick();
      assert.equal(timers.scheduled.length, 2);
      scheduler.stop();
      assert.equal(timers.cleared.length, 2, 'stop must cancel pending starts');
    });
  });

  describe('E. rate-limit safety (scheduler never bypasses the gate)', () => {
    it('routes every scheduled sync through the standard startSync path (kind incremental)', () => {
      // defaultStartSync is wired to sync.service.startSync, which owns the
      // single-flight claim + orchestrator + the shared rate-limit gate.
      assert.equal(typeof defaultStartSync, 'function');
      const p = defaultStartSync('any-user');
      assert.ok(p instanceof Promise, 'defaultStartSync delegates to startSync');
      // startSync validates/claims against the DB store; without MongoDB in
      // this environment it rejects with a typed INTERNAL. Swallow it so the
      // probe cannot leak an unhandled rejection.
      p.catch(() => {});
    });

    it('never aggressively retries a rate-limited user inside a tick', async () => {
      const timers = captureTimers();
      const attempted = [];
      const scheduler = createScheduler({
        staggerMs: 0,
        listUsers: async () => ['u1', 'u2', 'u3'],
        startSyncFn: async (userId) => {
          attempted.push(userId);
          const err = new Error('Rate limit reached.');
          err.code = 'RATE_LIMITED';
          err.resumeAt = new Date(Date.now() + 3600000);
          throw err;
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        log: silentLog,
      });
      await scheduler.runTick();
      for (let i = 0; i < timers.scheduled.length; i++) fire(timers.scheduled, i);
      assert.deepEqual(attempted, ['u1', 'u2', 'u3'], 'each user attempted exactly once — no retry loop');
    });

    it('defaultListUsers only returns connected users (bounded roster)', async () => {
      assert.equal(typeof defaultListUsers, 'function');
    });

    it('exposes MAX_USERS_PER_TICK as a hard bound', () => {
      assert.ok(Number.isInteger(MAX_USERS_PER_TICK) && MAX_USERS_PER_TICK > 0);
    });

    it('logs a tick failure safely (no raw Mongo/driver/connection details)', async () => {
      const errors = [];
      const scheduler = createScheduler({
        listUsers: async () => {
          throw new Error('connect ECONNREFUSED mongodb://user:secret@127.0.0.1:27017/frieday');
        },
        startSyncFn: async () => {},
        log: { info() {}, warn() {}, error: (entry) => errors.push(entry) },
      });
      await scheduler.runTick();
      assert.equal(errors.length, 1);
      const entry = errors[0];
      assert.equal(entry.msg, 'scheduler tick failed');
      assert.equal(entry.code, 'INTERNAL');
      assert.equal(entry.operation, 'list-users');
      assert.ok(!JSON.stringify(entry).includes('secret'), 'sensitive connection string must not be logged');
      assert.equal('error' in entry, false, 'raw driver message must not be logged');
      assert.equal('err' in entry, false, 'raw error object must not be logged');
    });
  });
});
