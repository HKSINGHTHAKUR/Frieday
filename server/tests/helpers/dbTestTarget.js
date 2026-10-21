/**
 * Test-only MongoDB target guard (INC-1 hardening).
 *
 * Why this exists
 * ---------------
 * The original INC-1 guard ran AFTER `db.connectDb()` and inspected
 * `mongoose.connection.host` (post-connection state). That ordering meant a
 * production-targeting `MONGO_URI` still opened a live connection to the
 * production cluster before the guard could reject it. A connection is not
 * read-only by default: the very first `create`/`update` on the opened
 * connection would write to production.
 *
 * This module validates the RESOLVED URI — the exact string that
 * `mongoose.connect()` will be handed — BEFORE any connection is attempted.
 * The check is therefore a true pre-flight gate: it cannot be bypassed by a
 * separate environment variable, because it inspects the same value the
 * connection uses.
 *
 * Rules
 * -----
 * - Allowed: loopback hosts only (`127.0.0.1`, `::1`, `localhost`) and the
 *   database name must contain "test" (case-insensitive). This keeps every
 *   existing isolated local test workflow working.
 * - Rejected: any non-loopback host (managed cloud, replica set, SSH tunnel,
 *   DNS name), any database name that does not look like a test database, and
 *   any URI that cannot be parsed unambiguously.
 * - The error message NEVER contains the URI, the host, the username, or the
 *   password — only a short, non-sensitive classification.
 *
 * Usage (test suites that connect through config/db):
 *
 *   const { connectForTest } = require('./helpers/dbTestTarget');
 *   await connectForTest();
 *
 * `connectForTest()` resolves the same MONGO_URI the connection will use,
 * validates it, and only then connects.
 *
 * @module server/tests/helpers/dbTestTarget
 */

'use strict';

const { URL } = require('node:url');

/** Hosts that are unambiguously the local machine. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

/** Database name must contain this token to be considered a test database. */
const TEST_DB_NAME_PATTERN = /test/i;

/**
 * Error thrown when a connection target is not an isolated local test
 * database. The message is deliberately free of any connection detail.
 */
class UnsafeDbTargetError extends Error {
  /**
   * @param {string} reason short, non-sensitive classification
   */
  constructor(reason) {
    super(
      `Refusing to connect to a non-isolated test database (${reason}). ` +
        'Tests may only connect to a loopback host with a "test" database name. ' +
        'Set MONGO_URI to an explicit local test URI, e.g. ' +
        'mongodb://127.0.0.1:27017/frieday_test_configdb.'
    );
    this.name = 'UnsafeDbTargetError';
    this.code = 'UNSAFE_DB_TARGET';
    this.reason = reason;
  }
}

/**
 * Parse a MongoDB URI without ever exposing credentials.
 *
 * Uses the WHATWG URL parser, which handles the `mongodb+srv://` scheme.
 * Credentials are read into local variables only and never returned.
 *
 * @param {string} uri
 * @returns {{ protocol: string, hostname: string, database: string, hasCredentials: boolean } | null}
 */
function parseMongoTarget(uri) {
  if (typeof uri !== 'string' || uri.trim().length === 0) return null;
  let parsed;
  try {
    parsed = new URL(uri.trim());
  } catch {
    return null;
  }
  const protocol = parsed.protocol.replace(/:$/, '');
  if (protocol !== 'mongodb' && protocol !== 'mongodb+srv') return null;

  // WHATWG URL keeps credentials in `username`/`password`; we only need the
  // boolean, never the values.
  const hasCredentials = Boolean(parsed.username || parsed.password);
  // Strip the leading "/" from the pathname to get the database name.
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  return {
    protocol,
    hostname: parsed.hostname,
    database,
    hasCredentials,
  };
}

/**
 * Classify a connection target without connecting.
 *
 * @param {string} uri the resolved connection string
 * @returns {{ safe: boolean, reason: string|null, protocol?: string, isLoopback?: boolean, databaseLooksLikeTest?: boolean }}
 */
function classifyDbTarget(uri) {
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    return { safe: false, reason: 'no connection string configured' };
  }
  const target = parseMongoTarget(uri);
  if (!target) {
    return { safe: false, reason: 'connection string could not be parsed' };
  }
  const isLoopback = LOOPBACK_HOSTS.has(target.hostname.toLowerCase());
  const databaseLooksLikeTest = TEST_DB_NAME_PATTERN.test(target.database);
  if (!isLoopback) {
    return {
      safe: false,
      reason: 'host is not a loopback address',
      protocol: target.protocol,
      isLoopback,
      databaseLooksLikeTest,
    };
  }
  if (!databaseLooksLikeTest) {
    return {
      safe: false,
      reason: 'database name does not identify a test database',
      protocol: target.protocol,
      isLoopback,
      databaseLooksLikeTest,
    };
  }
  return {
    safe: true,
    reason: null,
    protocol: target.protocol,
    isLoopback,
    databaseLooksLikeTest,
  };
}

/**
 * Assert that a connection target is an isolated local test database.
 * Throws {@link UnsafeDbTargetError} (non-sensitive message) when it is not.
 *
 * @param {string} uri the resolved connection string
 * @returns {true} when the target is safe
 * @throws {UnsafeDbTargetError} when the target is not an isolated test database
 */
function assertSafeTestDbTarget(uri) {
  const verdict = classifyDbTarget(uri);
  if (!verdict.safe) {
    throw new UnsafeDbTargetError(verdict.reason);
  }
  return true;
}

/**
 * Connect for a test — the ONLY sanctioned way for a test suite to open a
 * MongoDB connection.
 *
 * The resolved connection target is validated BEFORE the connection is
 * attempted, so a production-targeting MONGO_URI can never open a socket to
 * production. The validation inspects the exact string that
 * `mongoose.connect()` receives — it cannot be bypassed by a separate
 * environment variable.
 *
 * @param {Object} [opts]
 * @param {string} [opts.mongoUri] explicit target; defaults to the resolved MONGO_URI
 * @returns {Promise<typeof import('mongoose')>} the mongoose instance
 * @throws {UnsafeDbTargetError} when the target is not an isolated local test database
 */
async function connectForTest({ mongoUri } = {}) {
  const { getEnv } = require('../../src/config/env');
  const db = require('../../src/config/db');
  // Resolve the SAME string the connection will use, then gate on it.
  const uri = mongoUri !== undefined ? mongoUri : getEnv().MONGO_URI;
  assertSafeTestDbTarget(uri);
  return db.connectDb();
}

/**
 * Pin the test suite to an explicit isolated local test database.
 *
 * Why this exists
 * ---------------
 * `getEnv()` falls back to `mongodb://127.0.0.1:27017/frieday` when
 * MONGO_URI is unset — a database name the guard REJECTS (it does not
 * identify a test database). The result was that every DB-backed suite
 * silently SKIPPED when the ambient environment had no MONGO_URI: the suite
 * reported green while exercising nothing at all. A test that never runs is
 * worse than a test that fails.
 *
 * `useTestDatabase()` sets MONGO_URI to an explicit, isolated, loopback test
 * database BEFORE anything reads the environment, so the suite behaves
 * identically whether or not the shell happens to export MONGO_URI, and never
 * inherits the root `.env`'s production Atlas URI.
 *
 * The name contains "test", so the pre-flight guard accepts it.
 *
 * @param {string} [name] database name (default: 'frieday_test_suite')
 * @returns {string} the URI that was pinned
 */
function useTestDatabase(name = 'frieday_test_suite') {
  const uri = `mongodb://127.0.0.1:27017/${name}`;
  // Fail closed: never pin a URI the guard would reject.
  assertSafeTestDbTarget(uri);
  process.env.MONGO_URI = uri;
  return uri;
}

module.exports = {
  LOOPBACK_HOSTS,
  TEST_DB_NAME_PATTERN,
  UnsafeDbTargetError,
  assertSafeTestDbTarget,
  classifyDbTarget,
  connectForTest,
  parseMongoTarget,
  useTestDatabase,
};
