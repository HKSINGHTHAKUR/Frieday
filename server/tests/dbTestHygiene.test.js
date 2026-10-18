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

// Suites that connect via config/db (MONGO_URI — may point anywhere) must
// never contain an unscoped collection wipe.
const CONFIG_DB_SUITES = ['auth.test.js', 'repos.routes.test.js', 'timeline.routes.test.js', 'user-endpoints.test.js'];

const UNSCOPED_LINE = /\.deleteMany\(\s*\{\s*\}\s*\)/;

describe('INC-1 regression: DB-gated suites must never contain unscoped wipes', () => {
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

  it('every destructive DB-gated suite guards against non-test databases', () => {
    for (const file of CONFIG_DB_SUITES) {
      const src = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
      assert.match(
        src,
        /INC-1 guard/,
        `${file} must refuse to run against a non-test database (INC-1 guard)`
      );
    }
  });
});
