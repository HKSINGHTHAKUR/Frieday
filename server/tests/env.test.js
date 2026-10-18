/**
 * Config unit tests (tasks.md T0.2): missing/invalid env fail with named errors.
 * Run: npm run test -w server
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadEnv } = require('../src/config/env');

const VALID = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-jwt-secret-16+',
  // 64 hex characters = 32 bytes (AES-256-GCM, architecture.md §13).
  TOKEN_ENC_KEY: 'ab'.repeat(32),
};

describe('config/env', () => {
  it('loads defaults for optional vars', () => {
    const env = loadEnv({ ...VALID });
    assert.equal(env.PORT, 5000);
    assert.equal(env.SYNC_MAX_REPOS, 100);
    assert.equal(env.SCHEDULER_ENABLED, false);
    assert.equal(env.AI_ENABLED, false);
  });

  it('fails with a named error when TOKEN_ENC_KEY is missing', () => {
    const rest = { ...VALID };
    delete rest.TOKEN_ENC_KEY;
    assert.throws(() => loadEnv(rest), /Missing env: TOKEN_ENC_KEY/);
  });

  it('fails with a named error when JWT_SECRET is missing', () => {
    const rest = { ...VALID };
    delete rest.JWT_SECRET;
    assert.throws(() => loadEnv(rest), /Missing env: JWT_SECRET/);
  });

  it('fails with a named error when TOKEN_ENC_KEY is too short', () => {
    assert.throws(() => loadEnv({ ...VALID, TOKEN_ENC_KEY: 'too-short' }), /Invalid env: TOKEN_ENC_KEY/);
  });

  it('coerces numeric caps from strings', () => {
    const env = loadEnv({ ...VALID, SYNC_MAX_REPOS: '50' });
    assert.equal(env.SYNC_MAX_REPOS, 50);
  });

  it('defaults SYNC_CONCURRENCY to 2, coerces valid values, rejects invalid (T2.1)', () => {
    assert.equal(loadEnv({ ...VALID }).SYNC_CONCURRENCY, 2);
    assert.equal(loadEnv({ ...VALID, SYNC_CONCURRENCY: '3' }).SYNC_CONCURRENCY, 3);
    assert.throws(() => loadEnv({ ...VALID, SYNC_CONCURRENCY: '0' }), /Invalid env: SYNC_CONCURRENCY/);
    assert.throws(() => loadEnv({ ...VALID, SYNC_CONCURRENCY: 'abc' }), /Invalid env: SYNC_CONCURRENCY/);
  });
});
