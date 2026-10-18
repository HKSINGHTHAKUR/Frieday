/**
 * Session + crypto unit tests (tasks.md T1.2): crypto round-trip,
 * wrong-key/tamper/legacy failure (UNAUTHENTICATED), JWT issue/verify,
 * cross-type rejection, expiry, tamper, refresh-hash determinism.
 * No MongoDB required.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const session = require('../src/services/auth/session.service');
const cryptoSvc = require('../src/services/auth/crypto.service');

const KEY_A = 'ab'.repeat(32);
const KEY_B = 'cd'.repeat(32);

/**
 * Re-require a module under a different TOKEN_ENC_KEY (env is cached per
 * module load, so both cached modules must be busted together).
 */
function reloadCryptoService() {
  delete require.cache[require.resolve('../src/config/env')];
  delete require.cache[require.resolve('../src/services/auth/crypto.service')];
  return require('../src/services/auth/crypto.service');
}

/** Assert that `fn` throws and that the thrown error carries `code`. */
function throwsWithCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

describe('crypto.service (AES-256-GCM, T1.2)', () => {
  it('round-trips a token through encrypt/decrypt', () => {
    const token = 'gho_synthetic0123456789';
    const payload = cryptoSvc.encryptToken(token);
    assert.ok(payload.startsWith('v1:'), 'payload must carry the v1 version prefix');
    assert.ok(payload.split(':').length === 4, 'payload shape must be v1:iv:cipher:tag');
    assert.equal(cryptoSvc.decryptToken(payload), token);
  });

  it('produces a distinct payload per encryption (random IV)', () => {
    const token = 'gho_synthetic0123456789';
    assert.notEqual(cryptoSvc.encryptToken(token), cryptoSvc.encryptToken(token));
  });

  it('rejects a tampered ciphertext with UNAUTHENTICATED', () => {
    const payload = cryptoSvc.encryptToken('gho_synthetic0123456789');
    const parts = payload.split(':');
    const cipher = parts[2];
    parts[2] = cipher[0] === '0' ? `1${cipher.slice(1)}` : `0${cipher.slice(1)}`;
    throwsWithCode(() => cryptoSvc.decryptToken(parts.join(':')), 'UNAUTHENTICATED');
  });

  it('rejects malformed and legacy raw payloads with UNAUTHENTICATED', () => {
    for (const bad of ['gho_raw_legacy_token', 'v1:::', 'v2:aa:bb:cc:dd', '', undefined, 'not-a-payload']) {
      throwsWithCode(() => cryptoSvc.decryptToken(bad), 'UNAUTHENTICATED');
    }
  });

  it('fails to decrypt under a different 32-byte key (key rotation)', () => {
    const payload = cryptoSvc.encryptToken('gho_synthetic0123456789');
    process.env.TOKEN_ENC_KEY = KEY_B;
    const otherKey = reloadCryptoService();
    throwsWithCode(() => otherKey.decryptToken(payload), 'UNAUTHENTICATED');

    process.env.TOKEN_ENC_KEY = KEY_A;
    const original = reloadCryptoService();
    assert.equal(original.decryptToken(payload), 'gho_synthetic0123456789');
  });

  it('rejects a short key (16 bytes) at config load (fail-fast)', () => {
    const { loadEnv } = require('../src/config/env');
    assert.throws(
      () => loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-jwt-secret-16+', TOKEN_ENC_KEY: 'ab'.repeat(16) }),
      /TOKEN_ENC_KEY must be 64 hex/
    );
  });
});

describe('session.service JWTs (T1.2)', () => {
  it('issues an access + refresh pair sharing one session id', () => {
    const issued = session.issueSession(4242, 'octocat', ['read:user', 'repo']);
    const access = session.verifyAccess(issued.accessToken);
    const refresh = session.verifyRefresh(issued.refreshToken);
    assert.ok(access);
    assert.ok(refresh);
    assert.equal(access.githubId, 4242);
    assert.equal(access.login, 'octocat');
    assert.deepEqual(access.scopes, ['read:user', 'repo']);
    assert.equal(access.sid, refresh.sid);
    assert.equal(issued.sid, access.sid);
  });

  it('rejects a token presented as the wrong type', () => {
    const issued = session.issueSession(4242, 'octocat', []);
    assert.equal(session.verifyAccess(issued.refreshToken), null);
    assert.equal(session.verifyRefresh(issued.accessToken), null);
  });

  it('rejects empty, missing, or garbage tokens', () => {
    assert.equal(session.verifyAccess(undefined), null);
    assert.equal(session.verifyAccess(''), null);
    assert.equal(session.verifyAccess('garbage'), null);
    assert.equal(session.verifyRefresh(undefined), null);
    assert.equal(session.verifyRefresh('a.b.c'), null);
  });

  it('rejects a tampered payload (signature check)', () => {
    const issued = session.issueSession(4242, 'octocat', []);
    const [header, , signature] = issued.accessToken.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 1, sid: issued.sid, typ: 'access' })).toString(
      'base64url'
    );
    assert.equal(session.verifyJwt(`${header}.${forged}.${signature}`, 'access'), null);
  });

  it('rejects an expired token', () => {
    const expired = session.signJwt({ sub: 4242, sid: 's', typ: 'access' }, -1000);
    assert.equal(session.verifyJwt(expired, 'access'), null);
  });

  it('verifies a fresh token of the expected type', () => {
    const token = session.signJwt({ sub: 4242, sid: 's', typ: 'access' }, 60_000);
    const claims = session.verifyJwt(token, 'access');
    assert.ok(claims);
    assert.equal(claims.sub, 4242);
  });

  it('keeps refresh hashes deterministic and token-specific', () => {
    const h1 = session.refreshHash('token-1');
    const h2 = session.refreshHash('token-1');
    const h3 = session.refreshHash('token-2');
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
    assert.equal(h1.length, 64);
  });

  it('exposes the documented cookie flags (httpOnly, lax, path=/', () => {
    const opts = session.sessionCookieOptions();
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, 'lax');
    assert.equal(opts.secure, false, 'Secure is production-only');
    assert.equal(opts.path, '/');
    assert.equal(opts.maxAge, 15 * 60 * 1000);
    assert.equal(opts.refreshMaxAge, 7 * 24 * 60 * 60 * 1000);
  });
});
