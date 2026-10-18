/**
 * Scheduler (tasks.md T7.2, architecture.md §3 layer 10 / §4 / §18 decision 4).
 *
 * Cadence: EVERY 6 HOURS, staggered per user so all users do not hit GitHub
 * at the same instant. Implemented inside the documented `jobs/scheduler.js`
 * node-cron boundary; BullMQ + Redis remain the documented V1 migration path
 * (architecture.md §16) and are NOT implemented here (tasks.md T7.2: "not
 * implemented unless Phase 2 perf forces it — owner decides").
 *
 * Safety properties (all inherited, none re-invented):
 * - Every scheduled sync goes through `sync.service.startSync` → the existing
 *   per-user single-flight claim (partial unique index), rate-limit gate,
 *   concurrency cap, sync caps, error handling, and retry behavior. The
 *   scheduler itself never calls GitHub.
 * - No unbounded work: one start per user per tick, bounded by `maxUsers`,
 *   staggered by `staggerMs`; per-user failures are caught and logged, one bad
 *   user can never stop the tick or the process.
 * - No duplicate active jobs: an already-active sync for a user loses the
 *   claim (SYNC_CONFLICT) and is skipped with a warn log — never re-queued.
 * - No aggressive rate-limit retry: a rate-limited run ends honestly with
 *   RATE_LIMITED + resumeAt and is not retried inside this tick.
 *
 * Injectable for tests: `listUsers`, `startSyncFn`, `staggerMs`, and
 * `runTick` are exposed directly so tests never wait real hours and never
 * sleep. `start()`/`stop()` manage the node-cron task for production wiring.
 */
const cron = require('node-cron');
const User = require('../models/User');
const { startSync } = require('../services/sync/sync.service');
const logger = require('../utils/logger');

const DEFAULT_CRON = '0 */6 * * *'; // every 6 hours (00:00/06:00/12:00/18:00 UTC)
const DEFAULT_STAGGER_MS = 5000; // 5s between consecutive user starts within a tick
const MAX_USERS_PER_TICK = 1000; // hard bound on work created per tick

async function defaultListUsers(maxUsers) {
  const docs = await User.find({ githubTokenEnc: { $exists: true, $ne: null } })
    .select('_id')
    .limit(maxUsers)
    .lean()
    .exec();
  return docs.map((d) => String(d._id));
}

function defaultStartSync(userId) {
  return startSync(userId, { kind: 'incremental' });
}

function createScheduler({
  cronExpr = DEFAULT_CRON,
  staggerMs = DEFAULT_STAGGER_MS,
  maxUsers = MAX_USERS_PER_TICK,
  listUsers = defaultListUsers,
  startSyncFn = defaultStartSync,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  log = logger,
} = {}) {
  let task = null;
  let ticking = false;
  const timers = new Set();

  async function runTick() {
    if (ticking) return;
    ticking = true;
    try {
      const listed = await listUsers(maxUsers);
      // Hard bound regardless of the list source: the scheduler must never
      // create more than `maxUsers` starts per tick.
      const userIds = Array.isArray(listed) ? listed.slice(0, maxUsers) : [];
      log.info({ msg: 'scheduler tick', users: userIds.length, maxUsers });
      userIds.forEach((userId, index) => {
        const delay = index * staggerMs;
        const t = setTimer(() => {
          timers.delete(t);
          startSyncFn(userId).catch((err) => {
            const code = err && err.code ? err.code : 'INTERNAL';
            log.warn({ userId, code, operation: 'scheduled-sync' });
          });
        }, delay);
        timers.add(t);
      });
    } catch (err) {
      const code = err && typeof err.code === 'string' && err.code.length > 0 ? err.code : 'INTERNAL';
      log.error({ msg: 'scheduler tick failed', code, operation: 'list-users' });
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (task) return;
    task = cron.schedule(cronExpr, () => {
      runTick();
    });
    log.info({ msg: 'scheduler started', cron: cronExpr, staggerMs, maxUsers });
  }

  function stop() {
    if (task) {
      task.stop();
      task = null;
    }
    for (const t of timers) clearTimer(t);
    timers.clear();
  }

  return { runTick, start, stop };
}

module.exports = {
  createScheduler,
  DEFAULT_CRON,
  DEFAULT_STAGGER_MS,
  MAX_USERS_PER_TICK,
  defaultListUsers,
  defaultStartSync,
};
