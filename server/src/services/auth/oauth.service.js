/**
 * OAuth service (architecture.md §4/§7): state generation/verification,
 * code exchange, and the post-login user lookup. All GitHub network calls of
 * the OAuth flow live in this module (rules.md §11, agents.md §3.5).
 *
 * The access token NEVER reaches the client — only server-side results are
 * used to upsert the user and mint session cookies.
 */
const crypto = require('node:crypto');
const User = require('../../models/User');
const { getEnv } = require('../../config/env');
const { getGithubConfig } = require('../../config/github');

const STATE_TTL_MS = 10 * 60 * 1000;

// Consumed states are tracked within a single process lifetime to enforce
// one-time use of each state. Cross-restart replay is NOT prevented: after a
// server restart this Set is empty. The 10-minute cookie expiry is the
// cross-restart safety net — captured state+cookie pairs can no longer be
// replayed once they expire. Concurrent login tabs overwrite the cookie with
// the most recent state; earlier tabs' callbacks fail (query state !== cookie
// state) rather than being silently accepted.
const consumedStates = new Set();

/**
 * HMAC-SHA256 signature for a state payload, compared in constant time.
 * @param {string} state the OAuth state value
 * @param {number} expiresAt epoch ms when the state expires
 * @param {string} secret the HMAC key (JWT_SECRET)
 * @returns {string} hex signature
 */
function signPayload(state, expiresAt, secret) {
  return crypto.createHmac('sha256', secret).update(`${state}:${expiresAt}`).digest('hex');
}

/**
 * Constant-time comparison of a provided signature against the expected one.
 * Buffer-length mismatch returns false (never throws).
 * @param {string} expected the expected hex signature
 * @param {string} actual the provided hex signature
 * @returns {boolean}
 */
function constantTimeSigEqual(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const expBuf = Buffer.from(expected, 'hex');
  const actBuf = Buffer.from(actual, 'hex');
  if (expBuf.length !== actBuf.length) return false;
  return crypto.timingSafeEqual(expBuf, actBuf);
}

/**
 * Parse and validate a signed state cookie value.
 * Format: `${state}:${expiresAt}:${signature}`
 * @param {string} cookieValue raw cookie value
 * @param {string} secret HMAC key
 * @returns {{ state: string, expiresAt: number } | null } null when invalid
 */
function parseSignedState(cookieValue, secret) {
  if (typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split(':');
  if (parts.length !== 3) return null;
  const [state, expiresAtStr, sig] = parts;
  if (typeof state !== 'string' || state.length === 0) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) return null;
  const expectedSig = signPayload(state, expiresAt, secret);
  if (!constantTimeSigEqual(expectedSig, sig)) return null;
  return { state, expiresAt };
}

/**
 * @returns {{ beginAuth(): { state: string, authorizationUrl: string, cookieOptions: object },
 *             verifyState(state: string): boolean,
 *             exchange(code: string): Promise<{ accessToken: string, scopes: string[] }>,
 *             fetchProfile(accessToken: string): Promise<{ githubId: number, login: string, avatarUrl: string, profileUrl: string }>,
 *             upsertUser(record: object): Promise<{ githubId: number, login: string }> }}
 */
function createOAuthService() {
  function beginAuth() {
    const gh = getGithubConfig();
    if (!gh.clientId) {
      const err = new Error('GitHub OAuth App is not configured (set GITHUB_CLIENT_ID).');
      err.code = 'INVALID_CONFIG';
      throw err;
    }
    const state = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + STATE_TTL_MS;
    const cookieValue = `${state}:${expiresAt}:${signPayload(state, expiresAt, getEnv().JWT_SECRET)}`;
    const params = new URLSearchParams({
      client_id: gh.clientId,
      redirect_uri: gh.callbackUrl,
      scope: gh.scopes,
      state,
    });
    return {
      state,
      authorizationUrl: `${gh.authorizeUrl}?${params.toString()}`,
      cookieValue,
      cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure: getEnv().NODE_ENV === 'production',
        path: '/api/auth',
        maxAge: STATE_TTL_MS,
      },
    };
  }

  /**
   * Verify a `state` against a signed cookie value.
   *
   * Validation order: structure → state match → expiry → HMAC signature
   * (constant-time) → single-use (consumedStates). Every failure returns
   * false without throwing; no exception escapes this function.
   *
   * Successful verification consumes the state — each state is single-use
   * within the current process lifetime.
   *
   * @param {string} state the state from the query string
   * @param {string} cookieValue the signed cookie value from fd_oauth_state
   * @returns {boolean}
   */
  function verifyState(state, cookieValue) {
    if (typeof state !== 'string' || state.length === 0) return false;
    if (typeof cookieValue !== 'string' || cookieValue.length === 0) return false;

    const parsed = parseSignedState(cookieValue, getEnv().JWT_SECRET);
    if (!parsed) return false;
    if (parsed.state !== state) return false; // query/cookie mismatch
    if (parsed.expiresAt <= Date.now()) return false; // expired

    if (consumedStates.has(state)) return false; // already consumed (replay)
    consumedStates.add(state); // mark consumed (single-use)
    return true;
  }

  /**
   * Exchange an authorization code for an access token (POST, JSON response).
   * @param {string} code
   * @returns {Promise<{ accessToken: string, scopes: string[] }>}
   * @throws {Error} code `GITHUB_UNREACHABLE` on network/HTTP failure,
   *   `UNAUTHENTICATED` on access_denied/invalid_grant (user denied the flow).
   */
  async function exchange(code) {
    const gh = getGithubConfig();
    if (!gh.clientSecret) {
      const err = new Error('GitHub OAuth App is not configured (set GITHUB_CLIENT_SECRET).');
      err.code = 'INVALID_CONFIG';
      throw err;
    }
    // tokenUrl defaults to the GitHub token endpoint (config/env.js); it is
    // overridable in dev/CI for test doubles (T1.1 acceptance).
    const payload = {
      client_id: gh.clientId,
      client_secret: gh.clientSecret,
      code,
      redirect_uri: gh.callbackUrl,
    };
    let res;
    try {
      res = await fetch(gh.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(payload).toString(),
      });
    } catch (err) {
      const wrapped = new Error(`GitHub token endpoint unreachable: ${err.message}`);
      wrapped.code = 'GITHUB_UNREACHABLE';
      wrapped.retryable = true;
      throw wrapped;
    }
    const text = await res.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    if (!parsed.access_token || parsed.error) {
      // access_denied (user revoked) and invalid_grant both surface here.
      const err = new Error('GitHub authorization was not granted.');
      err.code = 'UNAUTHENTICATED';
      throw err;
    }
    return {
      accessToken: parsed.access_token,
      scopes: typeof parsed.scope === 'string' && parsed.scope.length > 0 ? parsed.scope.split(' ') : [],
    };
  }

  /**
   * Look up the authenticated GitHub account (GET /user) with a bearer token.
   * @param {string} accessToken
   * @returns {Promise<{ githubId: number, login: string, avatarUrl: string, profileUrl: string }>}
   * @throws {Error} code `GITHUB_UNREACHABLE` on failure
   */
  async function fetchProfile(accessToken) {
    const gh = getGithubConfig();
    let res;
    try {
      res = await fetch(gh.userApiUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Frieday',
        },
      });
    } catch (err) {
      const wrapped = new Error(`GitHub user lookup unreachable: ${err.message}`);
      wrapped.code = 'GITHUB_UNREACHABLE';
      wrapped.retryable = true;
      throw wrapped;
    }
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    if (!res.ok || !body.id) {
      const err = new Error(`GitHub user lookup failed (HTTP ${res.status}).`);
      err.code = 'GITHUB_UNREACHABLE';
      err.retryable = true;
      throw err;
    }
    return {
      githubId: body.id,
      login: body.login,
      avatarUrl: body.avatar_url,
      profileUrl: body.html_url,
    };
  }

  /**
   * Server-only: upsert the user with the exchanged token.
   * @param {{ githubId: number, login: string, avatarUrl: string, profileUrl: string, token: string, scopes: string[] }} record
   * @returns {Promise<{ githubId: number, login: string }>}
   */
  async function upsertUser(record) {
    return User.upsertOne(record);
  }

  return { beginAuth, verifyState, exchange, fetchProfile, upsertUser };
}

module.exports = { createOAuthService, STATE_TTL_MS };
