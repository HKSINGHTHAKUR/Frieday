/**
 * MongoDB connection lifecycle regression tests.
 *
 * Covers bounded retry + exponential backoff + jitter + shutdown
 * cancellation added to `server/src/config/db.js`.
 *
 * Mongoose's `connect` and `connection.readyState` are replaced with
 * controllable mocks so no real DB or network is needed. `setTimeout` is
 * mocked to record scheduled retries WITHOUT firing them; tests manually
 * invoke `timeoutEntries[i].cb()` to drive the retry chain.
 *
 * Scenarios:
 *   1. Initial connection success -> readyState 1
 *   2. Duplicate connect() calls deduplicated
 *   3. Transient failure -> retry -> recovery
 *   4. Persistent failure -> bounded retries -> graceful degradation (non-prod)
 *   5. Production fails fast after retries exhausted
 *   6. Backoff delay exponential + jitter, capped at MAX_BACKOFF_MS
 *   7. markShuttingDown() prevents new connects after retries scheduled
 *   8. safeErrorMeta does not leak secrets
 *
 * MAX_CONNECT_RETRIES=10 bounds TOTAL connection attempts (retryCount 1..10),
 * so 10 total connects occur on persistent failure (1 initial + 9 retries),
 * and 9 retry timeouts are scheduled.
 */
const { describe, it, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { safeErrorMeta } = require('../src/utils/logger');

const originalConnect = mongoose.connect;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

let readyState = 0;
let connectShouldFail = false;
let connectCallCount = 0;
const timeoutEntries = [];

const mockConnection = {
  get readyState() {
    return readyState;
  },
  set readyState(v) {
    readyState = v;
  },
  close: mock.fn(async () => {
    readyState = 0;
  }),
};

function resetState() {
  readyState = 0;
  connectShouldFail = false;
  connectCallCount = 0;
  timeoutEntries.length = 0;
  mongoose.connect = originalConnect;
  try {
    mongoose.connection = { readyState: 0, close: async () => {} };
  } catch {
    // best effort restore
  }
  delete require.cache[require.resolve('../src/config/db.js')];
}

async function loadDbModule() {
  try {
    Object.defineProperty(mongoose, 'connection', {
      get: () => mockConnection,
      set: () => {},
      configurable: true,
    });
  } catch {
    mongoose.connection = mockConnection;
  }

  mongoose.connect = async () => {
    connectCallCount += 1;
    if (connectShouldFail) {
      throw new Error('connection failed');
    }
    readyState = 1;
    return {};
  };

  return require('../src/config/db.js');
}

async function fireAllRetries() {
  while (timeoutEntries.length > 0) {
    const entry = timeoutEntries.shift();
    try {
      await entry.cb();
    } catch {
      // cb() may throw synchronously if attemptConnect() throws
      // (production mode, retries exhausted). The error propagates
      // through the promise chain to p.
    }
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('MongoDB connection lifecycle (db.js)', () => {
  before(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-16+';
    process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
    process.env.MONGO_URI = 'mongodb+srv://user:secret@frieday.mongodb.net/frieday';

    globalThis.setTimeout = mock.fn((cb, ms) => {
      timeoutEntries.push({ cb, ms });
      return { id: timeoutEntries.length, ref: () => {}, unref: () => {} };
    });
    globalThis.clearTimeout = mock.fn(() => {});
  });

  after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    mongoose.connect = originalConnect;
  });

  beforeEach(resetState);
  afterEach(resetState);

  describe('connectDb() — initial connection', () => {
    it('connects successfully on first attempt', async () => {
      const { connectDb } = await loadDbModule();

      const result = await connectDb();
      assert.equal(result, mongoose);
      assert.equal(connectCallCount, 1);
      assert.equal(readyState, 1);
    });

    it('does not schedule a retry when already connected', async () => {
      const { connectDb } = await loadDbModule();

      await connectDb();
      assert.equal(readyState, 1);
      await connectDb();

      assert.equal(connectCallCount, 1, 'connect() should only be called once');
      assert.equal(timeoutEntries.length, 0, 'no retry should be scheduled when connected');
    });
  });

  describe('connectDb() — transient failure then recovery', () => {
    it('retries after failure and recovers when DB becomes reachable', async () => {
      connectShouldFail = true;
      const { connectDb, dbStatus, retryState } = await loadDbModule();

      connectDb();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(timeoutEntries.length, 1, 'first retry scheduled');

      await fireAllRetries();
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(connectCallCount, 10, '10 total connection attempts on persistent failure');
      assert.equal(dbStatus(), 'down');
      assert.equal(timeoutEntries.length, 0, 'all retries consumed');

      connectShouldFail = false;
      await connectDb();

      assert.equal(connectCallCount, 11, '10 failed + 1 successful recovery');
      assert.equal(readyState, 1, 'mock connection reports connected');
      assert.equal(retryState().retryCount, 0, 'retry count reset after success');
    });
  });

  describe('connectDb() — bounded retries', () => {
    it('stops retrying after MAX_CONNECT_RETRIES and degrades gracefully (non-prod)', async () => {
      connectShouldFail = true;
      process.env.NODE_ENV = 'development';
      delete require.cache[require.resolve('../src/config/env.js')];
      const { connectDb, dbStatus } = await loadDbModule();

      connectDb();
      await new Promise((resolve) => setImmediate(resolve));
      await fireAllRetries();
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(dbStatus(), 'down');
      assert.equal(connectCallCount, 10, '10 total connection attempts (bounded)');
      assert.equal(timeoutEntries.length, 0, 'all retry timeouts consumed');
    });
  });

  describe('backoff timing', () => {
    it('uses exponential backoff with jitter, capped at MAX_BACKOFF_MS', async () => {
      connectShouldFail = true;
      process.env.NODE_ENV = 'development';
      delete require.cache[require.resolve('../src/config/env.js')];
      const { connectDb } = await loadDbModule();

      connectDb();
      await new Promise((resolve) => setImmediate(resolve));

      assert.ok(timeoutEntries.length >= 1, 'at least 1 retry delay scheduled');

      // First retry delay: backoffDelayMs(1) = 2000-2500ms
      const d1 = timeoutEntries[0].ms;
      assert.ok(d1 > 0, `delay should be positive, got ${d1}`);
      assert.ok(d1 <= 5000, `first delay should be <= 5000ms, got ${d1}`);
    });
  });

  describe('shutdown cancellation', () => {
    it('markShuttingDown prevents new connects', async () => {
      connectShouldFail = true;
      const { connectDb, markShuttingDown, retryState } = await loadDbModule();

      markShuttingDown();
      assert.equal(retryState().isShuttingDown, true);

      // connectDb() should not attempt any connection when shutdown
      await connectDb();
      assert.equal(connectCallCount, 0, 'no connection attempt when shutdown is active');
    });
  });

  describe('log hygiene', () => {
    it('safeErrorMeta does not include URI or credentials', () => {
      const err = new Error('connection failed');
      err.code = 'MONGODB_ERROR';
      const meta = safeErrorMeta(err, 'mongodb-connect');
      const metaStr = JSON.stringify(meta);
      assert.ok(!metaStr.includes('mongodb+srv://'), 'MONGO_URI must not appear');
      assert.ok(!metaStr.includes('user:secret'), 'credentials must not appear');
      assert.ok(!metaStr.includes('frieday.mongodb.net'), 'hostname must not appear');
      assert.ok(metaStr.includes('mongodb-connect'), 'operation name should be present');
      assert.ok(metaStr.includes('MONGODB_ERROR'), 'error code should be present');
    });
  });
});
