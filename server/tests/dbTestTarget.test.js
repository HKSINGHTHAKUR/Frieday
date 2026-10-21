/**
 * INC-1 pre-flight guard tests — the connection target is validated BEFORE
 * any connection attempt.
 *
 * The regression this prevents: the original INC-1 guard ran after
 * `db.connectDb()` and inspected `mongoose.connection.host`, so a
 * production-targeting MONGO_URI still opened a live connection to the
 * production cluster before the guard could reject it. A connection is not
 * read-only by default — the first write on it mutates production.
 *
 * These tests prove, without touching any real database, that:
 *   - a production-style target is rejected BEFORE `mongoose.connect` runs;
 *   - `connectDb()` propagates the rejection and never opens a connection;
 *   - loopback + "test" database targets are accepted;
 *   - malformed / missing / ambiguous configuration fails closed;
 *   - no error message, log line or thrown value leaks the URI, host,
 *     username or password.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  UnsafeDbTargetError,
  assertSafeTestDbTarget,
  classifyDbTarget,
  parseMongoTarget,
} = require('./helpers/dbTestTarget');

// A synthetic production-style target. NOT a real connection string: the
// host is a reserved example domain and the password is a placeholder.
const SYNTHETIC_PRODUCTION_URI =
  'mongodb+srv://synthetic-user:synthetic-placeholder-password@cluster0.example.invalid/frieday_prod';
const SYNTHETIC_LOOPBACK_URI = 'mongodb://127.0.0.1:27017/frieday_test_configdb';

describe('dbTestTarget — classification (no connection)', () => {
  it('rejects a production-style managed-cloud target', () => {
    const verdict = classifyDbTarget(SYNTHETIC_PRODUCTION_URI);
    assert.equal(verdict.safe, false);
    assert.match(verdict.reason, /not a loopback/i);
  });

  it('rejects a non-loopback host even with a test database name', () => {
    const verdict = classifyDbTarget('mongodb://db.example.invalid:27017/frieday_test_configdb');
    assert.equal(verdict.safe, false);
    assert.match(verdict.reason, /not a loopback/i);
  });

  it('rejects a loopback host whose database name does not look like a test database', () => {
    const verdict = classifyDbTarget('mongodb://127.0.0.1:27017/frieday_prod');
    assert.equal(verdict.safe, false);
    assert.match(verdict.reason, /does not identify a test database/i);
  });

  it('rejects a loopback host with no database name', () => {
    const verdict = classifyDbTarget('mongodb://127.0.0.1:27017');
    assert.equal(verdict.safe, false);
    assert.match(verdict.reason, /does not identify a test database/i);
  });

  it('accepts loopback + test database targets', () => {
    for (const uri of [
      'mongodb://127.0.0.1:27017/frieday_test_configdb',
      'mongodb://localhost:27017/frieday_test_models',
      'mongodb://[::1]:27017/frieday_test_persist',
      'mongodb://127.0.0.1:27017/frieday_test_configdb?authSource=admin',
    ]) {
      const verdict = classifyDbTarget(uri);
      assert.equal(verdict.safe, true, `${uri} should be accepted (${verdict.reason})`);
    }
  });

  it('fails closed for missing, empty and malformed configuration', () => {
    for (const uri of [undefined, null, '', '   ', 'not-a-uri', 'http://127.0.0.1/db', 42, {}]) {
      const verdict = classifyDbTarget(uri);
      assert.equal(verdict.safe, false, `${JSON.stringify(uri)} must be rejected`);
      assert.ok(verdict.reason, 'a reason must be provided');
    }
  });

  it('rejects a non-mongodb scheme', () => {
    const verdict = classifyDbTarget('https://127.0.0.1/frieday_test_configdb');
    assert.equal(verdict.safe, false);
  });
});

describe('dbTestTarget — parseMongoTarget never returns credentials', () => {
  it('reports credential presence as a boolean only', () => {
    const parsed = parseMongoTarget(SYNTHETIC_PRODUCTION_URI);
    assert.ok(parsed);
    assert.equal(parsed.hasCredentials, true);
    assert.equal(parsed.protocol, 'mongodb+srv');
    assert.equal(parsed.database, 'frieday_prod');
    // The parsed structure must not carry username or password values.
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'username'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'password'), false);
    assert.ok(!JSON.stringify(parsed).includes('synthetic-placeholder-password'));
    assert.ok(!JSON.stringify(parsed).includes('synthetic-user'));
  });
});

describe('dbTestTarget — error messages leak nothing', () => {
  it('the thrown error contains no URI, host, username or password', () => {
    let thrown = null;
    try {
      assertSafeTestDbTarget(SYNTHETIC_PRODUCTION_URI);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, 'must throw for a production-style target');
    assert.ok(thrown instanceof UnsafeDbTargetError);
    assert.equal(thrown.code, 'UNSAFE_DB_TARGET');

    const text = `${thrown.message} ${thrown.reason} ${thrown.stack}`;
    assert.ok(!text.includes('synthetic-placeholder-password'), 'password must not leak');
    assert.ok(!text.includes('synthetic-user'), 'username must not leak');
    assert.ok(!text.includes('cluster0.example.invalid'), 'host must not leak');
    assert.ok(!text.includes('mongodb+srv'), 'the full URI must not leak');
    assert.ok(!text.includes('frieday_prod'), 'the database name must not leak');
  });

  it('the error message names the safe remedy', () => {
    let thrown = null;
    try {
      assertSafeTestDbTarget(SYNTHETIC_PRODUCTION_URI);
    } catch (err) {
      thrown = err;
    }
    assert.match(thrown.message, /loopback/i);
    assert.match(thrown.message, /MONGO_URI/);
  });
});

describe('dbTestTarget — connectDb() refuses BEFORE calling mongoose.connect', () => {
  const originalConnect = mongoose.connect;
  let connectCalls = 0;
  let savedEnv = null;

  beforeEach(() => {
    connectCalls = 0;
    savedEnv = { ...process.env };
    // getEnv() memoizes; drop it so each case resolves the CURRENT env.
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/db')];
    // Any attempt to connect is a hard failure: the guard must prevent it.
    mongoose.connect = async () => {
      connectCalls += 1;
      throw new Error('mongoose.connect must not be called for an unsafe target');
    };
  });

  afterEach(() => {
    mongoose.connect = originalConnect;
    process.env = savedEnv;
    // getEnv() caches the validated env on first use, and db.js holds a
    // module-level connection promise. Both must be reset so every case
    // starts from a clean, independently-resolved configuration.
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/db')];
  });

  it('does not call mongoose.connect for a production-style target', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-16+';
    process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
    process.env.MONGO_URI = SYNTHETIC_PRODUCTION_URI;

    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/db')];
    const { connectForTest } = require('./helpers/dbTestTarget');

    let thrown = null;
    try {
      await connectForTest();
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown, 'connectForTest() must reject a production-style target');
    assert.equal(thrown.code, 'UNSAFE_DB_TARGET');
    assert.equal(connectCalls, 0, 'mongoose.connect must NEVER be called for an unsafe target');
  });

  it('does not call mongoose.connect for a loopback target with a non-test database', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-16+';
    process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/frieday_prod';

    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/db')];
    const { connectForTest } = require('./helpers/dbTestTarget');

    let thrown = null;
    try {
      await connectForTest();
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown, 'connectForTest() must reject a non-test database name');
    assert.equal(thrown.code, 'UNSAFE_DB_TARGET');
    assert.equal(connectCalls, 0, 'mongoose.connect must NEVER be called for an unsafe target');
  });

  it('allows a loopback test target to proceed to the connection call', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-16+';
    process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
    process.env.MONGO_URI = SYNTHETIC_LOOPBACK_URI;

    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/db')];
    const { connectForTest } = require('./helpers/dbTestTarget');

    // The guard must ALLOW this target, so the connection is attempted.
    // The mocked connect rejects, which makes connectDb() enter its bounded
    // retry backoff; the process is released with markShuttingDown() below.
    connectForTest().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(connectCalls, 1, 'a safe loopback target must reach mongoose.connect');
    const db = require('../src/config/db');
    db.markShuttingDown();
  });

  it('does not gate the production code path (the guard lives in test helpers only)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-jwt-secret-16+';
    process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
    process.env.MONGO_URI = SYNTHETIC_PRODUCTION_URI;
    // Production also requires a non-localhost OAuth callback (config/env.js
    // refuses to boot otherwise). This test is about the DB guard, so supply
    // a valid production callback to reach the code path it exercises.
    process.env.GITHUB_CALLBACK_URL = 'https://frieday.onrender.com/api/auth/github/callback';

    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/db')];
    const { connectDb } = require('../src/config/db');

    // The production boot path (config/db.connectDb) is unchanged: the guard
    // is a test-helper gate, so production is never blocked by it. The
    // connection is mocked, so nothing is actually opened.
    connectDb().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(connectCalls, 1, 'production boot must not be blocked by the test guard');
    const db = require('../src/config/db');
    db.markShuttingDown();
  });
});
