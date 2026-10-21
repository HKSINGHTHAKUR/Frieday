/**
 * Server bootstrap: validate env (fail-fast) → connect DB → listen.
 * Only file allowed to read dotenv directly via config/env.js path.
 */
const path = require('node:path');

// Load the single repo-root .env regardless of process.cwd(). npm workspace
// scripts (npm run dev -w server / start -w server) run with cwd=server/, so
// the cwd-relative dotenv default would miss the root .env. Resolving the
// path relative to this file (server/src → repo root) keeps the root .env the
// single source of truth for every documented command. In containers where
// env is injected at runtime (no .env file), dotenv silently no-ops — same as
// before.
//
// PRODUCTION NEVER LOADS .env. A deployed instance must take every value
// from its platform's environment (Render). If a .env ever ended up in a
// production image, its local-development OAuth callback and client id
// would silently take precedence over the injected values, and the sign-in
// would fail with "The redirect_uri is not associated with this application".
// Skipping the file makes that class of mistake impossible.
//
// dotenv also does NOT override variables already present in process.env, so
// a real env var always wins over the file — this is a second, belt-and-
// braces guard rather than the only one.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { getEnv } = require('./config/env');
const { connectDb, markShuttingDown } = require('./config/db');
const { createApp } = require('./app');
const logger = require('./utils/logger');
const { createScheduler } = require('./jobs/scheduler');

let server;
let scheduler;
let shuttingDown = false;

// Bounded fallback: if async cleanup (server close, MongoDB close) does not
// finish within this window, force-exit so a hung shutdown cannot keep the
// process alive indefinitely. Unref'd so it does not delay a clean exit.
const SHUTDOWN_TIMEOUT_MS = 10000;

async function main() {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    const code = err && typeof err.code === 'string' && err.code.length > 0 ? err.code : 'INVALID_CONFIG';
    // err.message contains only the variable name and validation rule
    // (e.g. "Missing env: JWT_SECRET" or "Invalid env: TOKEN_ENC_KEY — ..."),
    // never secret values — safe to log for deployment diagnostics.
    const message = err && typeof err.message === 'string' ? err.message : undefined;
    logger.error({ msg: 'invalid configuration', code, operation: 'boot-config', message });
    process.exitCode = 1;
    return;
  }

  await connectDb();

  const app = createApp();
  server = app.listen(env.PORT, () => {
    logger.info({ msg: 'server listening', port: env.PORT, env: env.NODE_ENV });
    if (env.SCHEDULER_ENABLED) {
      // 6h staggered per-user incremental syncs (tasks.md T7.2). On by
      // explicit opt-in only; disabled in MVP default (architecture.md §17).
      scheduler = createScheduler().start();
    }
  });

  function shutdown(signal) {
    markShuttingDown();
    if (shuttingDown) {
      logger.warn({ msg: 'shutdown already in progress, ignoring signal', signal });
      return;
    }
    shuttingDown = true;
    logger.info({ msg: 'shutdown initiated', signal });

    let hadError = false;
    const timer = setTimeout(() => {
      logger.error({
        msg: 'shutdown timed out, forcing exit',
        signal,
        ms: SHUTDOWN_TIMEOUT_MS,
        operation: 'shutdown-timeout',
      });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref?.();

    (async () => {
      // Stop accepting new connections (awaited — previously fired-and-forgotten).
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) {
            logger.error({ msg: 'server close error', code: err.code, operation: 'server-close' });
            hadError = true;
          } else {
            logger.info({ msg: 'server closed, no longer accepting new connections' });
          }
          resolve();
        });
      });

      // Stop scheduler from creating new work.
      if (scheduler) {
        scheduler.stop();
        logger.info({ msg: 'scheduler stopped' });
      }

      // Close MongoDB connection (awaited — Mongoose v8 close() returns a
      // Promise and does not accept a callback).
      try {
        const mongoose = require('mongoose');
        await mongoose.connection.close(false);
        logger.info({ msg: 'mongodb connection closed' });
      } catch (err) {
        logger.error({ msg: 'mongodb close error', code: err.code, operation: 'mongodb-close' });
        hadError = true;
      }

      clearTimeout(timer);
      if (hadError) {
        logger.error({ msg: 'shutdown completed with errors', signal, operation: 'shutdown-error' });
      } else {
        logger.info({ msg: 'shutdown complete', signal });
      }
      process.exit(0);
    })();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error({ msg: 'uncaught exception', code: err.code, message: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ msg: 'unhandled rejection', code: reason.code, reason: String(reason) });
    process.exit(1);
  });
}

main();
