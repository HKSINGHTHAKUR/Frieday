/**
 * INC-1 regression guard (test hygiene).
 *
 * Phase 8 incident: tests/user-endpoints.test.js cleanup used unscoped
 * `deleteMany({})` on every collection; when the suite was pointed at the
 * live deployment MONGO_URI it destroyed real user data.
 *
 * Two layers now protect against a repeat:
 * 1. Cleanups in every config/db-driven suite are scoped to that suite's
 *    own synthetic fixtures (githubId / userId allow-lists) — verified at
 *    runtime by running the suites against an isolated local test DB.
 * 2. This static test: any file that connects through config/db
 *    (`connectDb(`) — i.e. honors the live MONGO_URI — must not contain an
 *    unscoped `deleteMany({})` on a collection or model, and must carry the
 *    INC-1 guard that refuses non-test databases. Suites that deliberately
 *    wipe whole collections keep their dedicated local test database
 *    (hardcoded 127.0.0.1/frieday_test_*).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TESTS_DIR = __dirname;

/**
 * Discover the suites that connect through config/db.
 *
 * The list is DISCOVERED, not hard-coded: a hand-maintained list silently
 * stops covering new suites (the Phase 10.2 theme suite was invisible to
 * this guard for exactly that reason). A suite qualifies when it requires
 * `config/db` — the module that honours the ambient MONGO_URI.
 */
function discoverConfigDbSuites() {
  return (
    fs
      .readdirSync(TESTS_DIR)
      .filter((f) => f.endsWith('.test.js'))
      // This file is the guard itself: it mentions config/db and connectForTest
      // in its own source, but it opens no connection.
      .filter((f) => f !== 'dbTestHygiene.test.js')
      .filter((f) => {
        const src = fs.readFileSync(path.join(TESTS_DIR, f), 'utf8');
        return /config\/db/.test(src);
      })
      .sort()
  );
}

const CONFIG_DB_SUITES = discoverConfigDbSuites();

/**
 * Whether a suite opens a real MongoDB connection.
 *
 * `connectForTest()` is the sanctioned path for opening one; a suite that
 * calls it honours the ambient MONGO_URI and must therefore be guarded and
 * pinned. A suite that does not call it replaces `mongoose.connect` and
 * never opens a socket (e.g. db.test.js, dbTestTarget.test.js) — there is no
 * real target to guard, so the connection-level rules do not apply to it.
 */
function opensRealConnection(src) {
  return /connectForTest\(/.test(src);
}

/** The suites that actually open a socket — the ones the INC-1 rules apply to. */
const REAL_CONNECT_SUITES = CONFIG_DB_SUITES.filter((f) =>
  opensRealConnection(fs.readFileSync(path.join(TESTS_DIR, f), 'utf8'))
);

const UNSCOPED_LINE = /\.deleteMany\(\s*\{\s*\}\s*\)/;

/** The suites this guard must always cover, whatever the discovery finds. */
const REQUIRED_REAL_CONNECT_SUITES = [
  'auth.test.js',
  'repos.repoThemes.test.js',
  'repos.routes.test.js',
  'timeline.routes.test.js',
  'user-endpoints.test.js',
];

describe('INC-1 regression: DB-gated suites must never contain unscoped wipes', () => {
  it('discovers the config/db-based suites', () => {
    // The discovery must actually find the known suites — otherwise this
    // guard would silently pass by checking nothing.
    for (const expected of REQUIRED_REAL_CONNECT_SUITES) {
      assert.ok(
        CONFIG_DB_SUITES.includes(expected),
        `${expected} must be covered by the INC-1 guard (discovered: ${CONFIG_DB_SUITES.join(', ')})`
      );
    }
  });

  it('config/db-based suites have no unscoped deleteMany({}) cleanup', () => {
    for (const file of CONFIG_DB_SUITES) {
      const src = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
      const unscoped = src.split('\n').filter((line) => UNSCOPED_LINE.test(line));
      assert.equal(
        unscoped.length,
        0,
        `${file} must scope every deleteMany to the suite's own synthetic records ` +
          `(found ${unscoped.length} unscoped wipe(s)) — INC-1 regression guard`
      );
    }
  });

  it('every suite that opens a real connection guards against non-test databases', () => {
    for (const file of REAL_CONNECT_SUITES) {
      const src = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
      assert.match(
        src,
        /INC-1 guard/,
        `${file} must refuse to run against a non-test database (INC-1 guard)`
      );
    }
  });

  it('every suite that opens a real connection pins an explicit isolated test database', () => {
    // Without an explicit target, getEnv() falls back to the default
    // `frieday` database, which the pre-flight guard REJECTS — so the suite
    // silently SKIPS its DB-backed tests and reports green while exercising
    // nothing. Every suite that opens a REAL connection must therefore pin
    // an isolated local test database.
    for (const file of REAL_CONNECT_SUITES) {
      const src = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
      assert.match(
        src,
        /useTestDatabase\(|127\.0\.0\.1:27017\/frieday_test/,
        `${file} opens a real MongoDB connection and must pin an explicit isolated local ` +
          `test database (useTestDatabase) so its DB-backed tests cannot silently skip`
      );
    }
  });

  it('the discovery finds every suite that opens a real connection', () => {
    // The exemption must not silently swallow a suite that really connects.
    for (const expected of REQUIRED_REAL_CONNECT_SUITES) {
      assert.ok(
        REAL_CONNECT_SUITES.includes(expected),
        `${expected} opens a real connection and must be covered by the pin and guard rules ` +
          `(real connectors: ${REAL_CONNECT_SUITES.join(', ')})`
      );
    }
  });
});
