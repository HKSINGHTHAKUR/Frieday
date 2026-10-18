/**
 * MongoDB connection via Mongoose (architecture.md §6).
 * Phase 0: connect only; models arrive in Phase 3 (T3.1).
 */
const mongoose = require('mongoose');
const { getEnv } = require('./env');
const logger = require('../utils/logger');
const { safeErrorMeta } = require('../utils/logger');

let connecting = null;

/**
 * Connect to MongoDB. Resolves even when unreachable in non-production so
 * `npm run dev` works without a local DB; `/api/health` reports `db: down`.
 * Production boot fails fast (fail-fast per rules.md §10).
 * @returns {Promise<typeof mongoose>} mongoose instance
 */
async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  // A completed connect→disconnect cycle (tests, drills) must be able to
  // reconnect: the cached promise is stale once the connection is closed.
  if (mongoose.connection.readyState === 0) {
    connecting = null;
  }
  if (!connecting) {
    const env = getEnv();
    connecting = mongoose
      .connect(env.MONGO_URI, { serverSelectionTimeoutMS: 2000 })
      .then(() => {
        logger.info({ msg: 'mongodb connected' });
        return mongoose;
      })
      .then(() => {
        logger.info({ msg: 'mongodb connected' });
        return mongoose;
      })
      .catch((err) => {
        connecting = null;
        // err.message may embed the Mongo URI — log safe metadata only.
        logger.warn({ msg: 'mongodb unreachable', ...safeErrorMeta(err, 'mongodb-connect') });
        if (env.NODE_ENV === 'production') {
          throw err;
        }
        return mongoose;
      });
  }
  return connecting;
}

/**
 * Live DB status for the health endpoint.
 * @returns {'up'|'down'}
 */
function dbStatus() {
  return mongoose.connection.readyState === 1 ? 'up' : 'down';
}

module.exports = { connectDb, dbStatus };
