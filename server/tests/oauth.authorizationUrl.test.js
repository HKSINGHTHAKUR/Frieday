/**
 * The generated GitHub authorization URL, per environment.
 *
 * `beginAuth()` builds the URL the browser is redirected to. This test pins
 * the `redirect_uri` it carries for BOTH environments, so a local callback
 * can never leak into a production authorization request (or vice versa).
 *
 * The OAuth service reads the validated env through `config/env.js`, which
 * caches after the first read. Each case therefore runs in a CHILD PROCESS
 * with its own env, so there is no cross-case cache bleed.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..');

/**
 * Builds the authorization URL in a child process with a given environment.
 * @param {Record<string,string>} env
 * @returns {{ authorizationUrl: string, redirectUri: string }}
 */
function buildAuthorizationUrl(env) {
  const script = `
    const { createOAuthService } = require(${JSON.stringify(
      path.join(SERVER_ROOT, 'src/services/auth/oauth.service.js')
    )});
    const oauth = createOAuthService();
    const { authorizationUrl } = oauth.beginAuth();
    const url = new URL(authorizationUrl);
    process.stdout.write(JSON.stringify({
      authorizationUrl,
      redirectUri: url.searchParams.get('redirect_uri'),
      host: url.host,
      pathname: url.pathname,
    }));
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: SERVER_ROOT,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: env.NODE_ENV,
      JWT_SECRET: 'test-jwt-secret-16+',
      TOKEN_ENC_KEY: 'ab'.repeat(32),
      GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: 'test-client-secret',
      GITHUB_CALLBACK_URL: env.GITHUB_CALLBACK_URL,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

describe('OAuth authorization URL — per environment', () => {
  it('production sends the public production redirect_uri', () => {
    const result = buildAuthorizationUrl({
      NODE_ENV: 'production',
      GITHUB_CLIENT_ID: 'prod-client-id',
      GITHUB_CALLBACK_URL: 'https://frieday.onrender.com/api/auth/github/callback',
    });
    assert.equal(result.host, 'github.com');
    assert.equal(result.pathname, '/login/oauth/authorize');
    assert.equal(result.redirectUri, 'https://frieday.onrender.com/api/auth/github/callback');
    assert.ok(
      !result.redirectUri.includes('localhost'),
      'the production redirect_uri must never contain localhost'
    );
  });

  it('local development sends the local redirect_uri', () => {
    const result = buildAuthorizationUrl({
      NODE_ENV: 'development',
      GITHUB_CLIENT_ID: 'local-client-id',
      GITHUB_CALLBACK_URL: 'http://localhost:5000/api/auth/github/callback',
    });
    assert.equal(result.host, 'github.com');
    assert.equal(result.pathname, '/login/oauth/authorize');
    assert.equal(result.redirectUri, 'http://localhost:5000/api/auth/github/callback');
  });

  it('the two environments use different redirect_uris and different client ids', () => {
    const prod = buildAuthorizationUrl({
      NODE_ENV: 'production',
      GITHUB_CLIENT_ID: 'prod-client-id',
      GITHUB_CALLBACK_URL: 'https://frieday.onrender.com/api/auth/github/callback',
    });
    const local = buildAuthorizationUrl({
      NODE_ENV: 'development',
      GITHUB_CLIENT_ID: 'local-client-id',
      GITHUB_CALLBACK_URL: 'http://localhost:5000/api/auth/github/callback',
    });
    assert.notEqual(prod.redirectUri, local.redirectUri);
    // Each environment must carry its OWN OAuth App client id.
    assert.ok(prod.authorizationUrl.includes('client_id=prod-client-id'));
    assert.ok(local.authorizationUrl.includes('client_id=local-client-id'));
    assert.ok(!prod.authorizationUrl.includes('local-client-id'));
    assert.ok(!local.authorizationUrl.includes('prod-client-id'));
  });

  it('never sends a production redirect_uri to the local environment', () => {
    const local = buildAuthorizationUrl({
      NODE_ENV: 'development',
      GITHUB_CLIENT_ID: 'local-client-id',
      GITHUB_CALLBACK_URL: 'http://localhost:5000/api/auth/github/callback',
    });
    assert.ok(
      !local.redirectUri.includes('frieday.onrender.com'),
      'the local callback must not point at production'
    );
  });
});
