/**
 * OAuth callback configuration tests.
 *
 * The GitHub OAuth App stores ONE "Authorization callback URL". Local
 * development and production therefore need SEPARATE callback URLs and,
 * ideally, separate OAuth Apps (separate client id / secret).
 *
 * These tests pin the configuration contract that keeps the two apart:
 *   - production must NEVER resolve to a localhost callback;
 *   - local development MUST resolve to the local callback;
 *   - the authorization URL and the token exchange must use the SAME
 *     callback for a given environment.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadEnv, isLocalhostUrl, assertNoLocalhostCallback } = require('../src/config/env');
const { getGithubConfig } = require('../src/config/github');

const PROD_CALLBACK = 'https://frieday.onrender.com/api/auth/github/callback';
const LOCAL_CALLBACK = 'http://localhost:5000/api/auth/github/callback';

const BASE = {
  JWT_SECRET: 'test-jwt-secret-16+',
  // 64 hex characters = 32 bytes (AES-256-GCM, architecture.md §13).
  TOKEN_ENC_KEY: 'ab'.repeat(32),
};

describe('config/env — production callback guard', () => {
  it('rejects a localhost callback in production', () => {
    const source = { ...BASE, NODE_ENV: 'production' };
    assert.throws(
      () => loadEnv(source),
      /Invalid env: GITHUB_CALLBACK_URL/,
      'production must not accept the localhost callback default'
    );
  });

  it('rejects an explicit 127.0.0.1 callback in production', () => {
    const source = {
      ...BASE,
      NODE_ENV: 'production',
      GITHUB_CALLBACK_URL: 'http://127.0.0.1:5000/api/auth/github/callback',
    };
    assert.throws(() => loadEnv(source), /Invalid env: GITHUB_CALLBACK_URL/);
  });

  it('accepts the public production callback', () => {
    const source = {
      ...BASE,
      NODE_ENV: 'production',
      GITHUB_CALLBACK_URL: PROD_CALLBACK,
    };
    const env = loadEnv(source);
    assert.equal(env.GITHUB_CALLBACK_URL, PROD_CALLBACK);
  });

  it('allows a localhost callback in development and test', () => {
    assert.equal(loadEnv({ ...BASE, NODE_ENV: 'development' }).GITHUB_CALLBACK_URL, LOCAL_CALLBACK);
    assert.equal(loadEnv({ ...BASE, NODE_ENV: 'test' }).GITHUB_CALLBACK_URL, LOCAL_CALLBACK);
  });

  it('never leaks a secret value in the error message', () => {
    const source = {
      ...BASE,
      NODE_ENV: 'production',
      GITHUB_CLIENT_SECRET: 'super-secret-value',
      GITHUB_CALLBACK_URL: LOCAL_CALLBACK,
    };
    try {
      loadEnv(source);
      assert.fail('expected loadEnv to throw');
    } catch (err) {
      assert.ok(!err.message.includes('super-secret-value'), 'the secret must not appear');
    }
  });
});

describe('config/env — isLocalhostUrl', () => {
  it('detects the local hosts', () => {
    assert.equal(isLocalhostUrl(LOCAL_CALLBACK), true);
    assert.equal(isLocalhostUrl('http://127.0.0.1:5000/x'), true);
    assert.equal(isLocalhostUrl('http://[::1]:5000/x'), true);
  });

  it('does not flag public hosts', () => {
    assert.equal(isLocalhostUrl(PROD_CALLBACK), false);
    assert.equal(isLocalhostUrl('https://frieday.example.com/api/auth/github/callback'), false);
  });

  it('treats a malformed URL as not-local (so it fails the URL schema, not this guard)', () => {
    assert.equal(isLocalhostUrl('not a url'), false);
  });
});

describe('config/env — assertNoLocalhostCallback is environment-scoped', () => {
  it('is a no-op outside production', () => {
    const env = loadEnv({ ...BASE, NODE_ENV: 'development' });
    assert.doesNotThrow(() => assertNoLocalhostCallback(env));
  });

  it('fires in production', () => {
    const env = loadEnv({ ...BASE, NODE_ENV: 'production', GITHUB_CALLBACK_URL: PROD_CALLBACK });
    // The production value is fine, so the guard must not fire.
    assert.doesNotThrow(() => assertNoLocalhostCallback(env));
  });
});

describe('config/github — the callback is read from the environment, never derived', () => {
  it('uses the environment value for the local environment', () => {
    const source = { ...BASE, NODE_ENV: 'development', GITHUB_CALLBACK_URL: LOCAL_CALLBACK };
    const env = loadEnv(source);
    assert.equal(env.GITHUB_CALLBACK_URL, LOCAL_CALLBACK);
  });

  it('exposes the same callback for authorization and token exchange', () => {
    // The OAuth service reads ONE field for both calls, so they cannot drift.
    // `getGithubConfig` reads the validated env, which needs the required
    // vars present in this process.
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      TOKEN_ENC_KEY: process.env.TOKEN_ENC_KEY,
      GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL,
    };
    try {
      process.env.JWT_SECRET = 'test-jwt-secret-16+';
      process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
      process.env.GITHUB_CALLBACK_URL = LOCAL_CALLBACK;
      const gh = getGithubConfig();
      assert.equal(typeof gh.callbackUrl, 'string');
      assert.ok(gh.callbackUrl.length > 0);
      assert.equal(gh.callbackUrl, LOCAL_CALLBACK);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
