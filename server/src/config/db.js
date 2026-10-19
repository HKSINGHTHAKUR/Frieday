/**
 * MongoDB connection via Mongoose (architecture.md §6).
 * Phase 0: connect only; models arrive in Phase 3 (T3.1).
 */
const mongoose = require('mongoose');
const { getEnv } = require('./env');
const logger = require('../utils/logger');
const { safeErrorMeta } = require('../utils/logger');

// Retry configuration for transient MongoDB outages. Bounded exponential
// backoff with jitter prevents thundering herds and infinite retry loops.
const MAX_CONNECT_RETRIES = 10;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

let connecting = null;
let retryCount = 0;
let retryTimeoutId = null;
let isShuttingDown = false;

/**
 * Clear any pending retry timer (called during shutdown).
 */
function clearRetryTimer() {
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
}

/**
 * Mark shutdown in progress so no new retry attempts are scheduled.
 */
function markShuttingDown() {
  isShuttingDown = true;
  clearRetryTimer();
}

/**
 * Compute the next backoff delay with jitter: exponential growth capped at
 * MAX_BACKOFF_MS, plus up to 25% jitter to avoid synchronized retries.
 * @param {number} attempt zero-based retry attempt index
 * @returns {number} delay in milliseconds
 */
function backoffDelayMs(attempt) {
  const exponential = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * exponential * 0.25);
  return exponential + jitter;
}

/**
 * Schedule the next connection retry with exponential backoff.
 * Returns a promise that resolves when the retry attempt completes.
 */
function scheduleRetry() {
  if (isShuttingDown || retryCount >= MAX_CONNECT_RETRIES) {
    return Promise.resolve(mongoose);
  }
  const delay = backoffDelayMs(retryCount);
  logger.info({
    msg: 'mongodb retry scheduled',
    retry: retryCount + 1,
    maxRetries: MAX_CONNECT_RETRIES,
    delayMs: delay,
    operation: 'mongodb-retry-schedule',
  });
  return new Promise((resolve) => {
    retryTimeoutId = setTimeout(() => {
      retryTimeoutId = null;
      resolve(attemptConnect());
    }, delay);
    // Unref so a pending retry timer does not keep the process alive.
    if (typeof retryTimeoutId.unref === 'function') {
      retryTimeoutId.unref();
    }
  });
}

/**
 * Attempt a single MongoDB connection. On failure in non-production, schedules
 * a bounded retry. Production boot still fails fast; after boot, retries apply
 * in all environments so transient outages self-heal.
 */
function attemptConnect() {
  if (isShuttingDown) {
    return Promise.resolve(mongoose);
  }
  if (mongoose.connection.readyState === 1) {
    retryCount = 0;
    clearRetryTimer();
    return Promise.resolve(mongoose);
  }
  // A completed connect→disconnect cycle (tests, drills) must be able to
  // reconnect: the cached promise is stale once the connection is closed.
  if (mongoose.connection.readyState === 0) {
    connecting = null;
    // Do NOT reset retryCount here — it's managed by the retry logic
    // (incremented on each attempt, reset to 0 on successful connection).
  }
  if (!connecting) {
    const env = getEnv();
    retryCount += 1;
    connecting = mongoose
      .connect(env.MONGO_URI, { serverSelectionTimeoutMS: 2000 })
      .then(() => {
        logger.info({ msg: 'mongodb connected' });
        retryCount = 0;
        clearRetryTimer();
        return mongoose;
      })
      .catch((err) => {
        connecting = null;
        // err.message may embed the Mongo URI — log safe metadata only.
        logger.warn({ msg: 'mongodb unreachable', ...safeErrorMeta(err, 'mongodb-connect') });
        if (retryCount < MAX_CONNECT_RETRIES) {
          return scheduleRetry().then(() => mongoose);
        }
        // Retries exhausted: production fails fast at boot; non-production
        // degrades gracefully with db: down reported by health.
        if (env.NODE_ENV === 'production') {
          throw err;
        }
        return mongoose;
      });
  }
  return connecting;
}

/**
 * Connect to MongoDB. Retries with bounded exponential backoff on transient
 * failure so the server self-heals when MongoDB becomes reachable again.
 * Production boot fails fast (fail-fast per rules.md §10).
 * @returns {Promise<typeof mongoose>} mongoose instance
 */
async function connectDb() {
  return attemptConnect();
}

/**
 * Live DB status for the health endpoint.
 * @returns {'up'|'down'}
 */
function dbStatus() {
  return mongoose.connection.readyState === 1 ? 'up' : 'down';
}

/**
 * Expose retry state for tests and shutdown coordination.
 * @returns {{ retryCount: number, maxRetries: number, isShuttingDown: boolean }}
 */
function retryState() {
  return { retryCount, maxRetries: MAX_CONNECT_RETRIES, isShuttingDown };
}

module.exports = { connectDb, dbStatus, markShuttingDown, retryState };
