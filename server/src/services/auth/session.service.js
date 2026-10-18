/**
 * Session service (architecture.md §7/§13, rules.md §7) — T1.2.
 *
 * fd_access  — HS256 JWT (JWT_SECRET), 15 min, claims:
 *              { sub: githubId, sid, typ: 'access', login, scopes }
 * fd_refresh — HS256 JWT (JWT_SECRET), 7-day sliding window, claims:
 *              { sub: githubId, sid, typ: 'refresh' }
 *
 * Rotation: every POST /api/auth/refresh issues a fresh pair under the SAME
 * session id. The SHA-256 of the current refresh token is persisted on the
 * user document (raw refresh tokens are never stored). Presenting an
 * already-rotated (reused) refresh token invalidates the whole session —
 * the persisted session id is cleared, so the current access token fails
 * requireAuth immediately.
 */
const crypto = require('node:crypto');
const { getEnv } = require('../../config/env');
const User = require('../../models/User');

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Sign an HS256 JWT (internal; exported for tests).
 * @param {object} claims
 * @param {number} ttlMs
 * @returns {string}
 */
function signJwt(claims, ttlMs) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ ...claims, iat: nowSec, exp: nowSec + Math.floor(ttlMs / 1000) }));
  const signature = crypto
    .createHmac('sha256', getEnv().JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Verify an HS256 JWT: signature (timing-safe) + expiry + typ.
 * @param {string|undefined} token
 * @param {string} [expectedTyp]
 * @returns {object|null} claims, or null when invalid/expired/wrong type
 */
function verifyJwt(token, expectedTyp) {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', getEnv().JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || Math.floor(Date.now() / 1000) >= claims.exp) {
    return null;
  }
  if (expectedTyp && claims.typ !== expectedTyp) {
    return null;
  }
  return claims;
}

/**
 * SHA-256 of a refresh token — only the hash is persisted (rules.md §7).
 * @param {string} token
 * @returns {string}
 */
function refreshHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Issue a session pair.
 * @param {number} githubId
 * @param {string} login
 * @param {string[]} scopes
 * @param {string} [sid] rotation reuses the existing session id
 * @returns {{ accessToken: string, refreshToken: string, sid: string }}
 */
function issueSession(githubId, login, scopes, sid) {
  const sessionId = sid ?? crypto.randomBytes(16).toString('hex');
  const accessToken = signJwt({ sub: githubId, sid: sessionId, typ: 'access', login, scopes }, ACCESS_TTL_MS);
  const refreshToken = signJwt({ sub: githubId, sid: sessionId, typ: 'refresh' }, REFRESH_TTL_MS);
  return { accessToken, refreshToken, sid: sessionId };
}

/**
 * @param {string|undefined} token
 * @returns {{ githubId: number, sid: string, login: string, scopes: string[] }|null}
 */
function verifyAccess(token) {
  const claims = verifyJwt(token, 'access');
  if (!claims || typeof claims.sub !== 'number' || typeof claims.sid !== 'string') {
    return null;
  }
  return {
    githubId: claims.sub,
    sid: claims.sid,
    login: typeof claims.login === 'string' ? claims.login : '',
    scopes: Array.isArray(claims.scopes) ? claims.scopes : [],
  };
}

/**
 * @param {string|undefined} token
 * @returns {{ githubId: number, sid: string }|null}
 */
function verifyRefresh(token) {
  const claims = verifyJwt(token, 'refresh');
  if (!claims || typeof claims.sub !== 'number' || typeof claims.sid !== 'string') {
    return null;
  }
  return { githubId: claims.sub, sid: claims.sid };
}

/**
 * Persist session state for a fresh session (login callback).
 * @param {number} githubId
 * @param {{ accessToken: string, refreshToken: string, sid: string }} issued
 */
async function persistSession(githubId, issued) {
  await User.updateOne(
    { githubId },
    { $set: { sessionId: issued.sid, refreshTokenHash: refreshHash(issued.refreshToken) } }
  ).exec();
}

/**
 * Rotation step: store the newly issued refresh token (same session id).
 * @param {number} githubId
 * @param {{ accessToken: string, refreshToken: string, sid: string }} issued
 */
async function persistRotation(githubId, issued) {
  await User.updateOne({ githubId }, { $set: { refreshTokenHash: refreshHash(issued.refreshToken) } }).exec();
}

/**
 * Invalidate the persisted session (logout / disconnect / reuse detection).
 * @param {number} githubId
 */
async function invalidatePersistedSession(githubId) {
  await User.updateOne({ githubId }, { $set: { sessionId: null, refreshTokenHash: null } }).exec();
}

/**
 * Shared cookie flags (architecture.md §13): HttpOnly; Secure (prod);
 * SameSite=Lax; Path=/.
 * @returns {object}
 */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().NODE_ENV === 'production',
    path: '/',
    maxAge: ACCESS_TTL_MS,
    refreshMaxAge: REFRESH_TTL_MS,
  };
}

module.exports = {
  issueSession,
  verifyAccess,
  verifyRefresh,
  refreshHash,
  persistSession,
  persistRotation,
  invalidatePersistedSession,
  sessionCookieOptions,
  signJwt,
  verifyJwt,
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
};
