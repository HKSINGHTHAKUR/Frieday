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
const states = new Map();

// Lazy prune so the map cannot grow unbounded on abandoned authorizations.
function pruneStates(now) {
  for (const [state, expiresAt] of states) {
    if (expiresAt <= now) {
      states.delete(state);
    }
  }
}

/**
 * @returns {{ beginAuth(): { state: string, authorizationUrl: string, cookieOptions: object },
 *             verifyState(state: string): boolean,
 *             exchange(code: string): Promise<{ accessToken: string, scopes: string[] }>,
 *             fetchProfile(accessToken: string): Promise<{ githubId: number, login: string, avatarUrl: string, profileUrl: string }>,
 *             upsertUser(record: object): Promise<{ githubId: number, login: string }> }}
 */
function createOAuthService() {
  /**
   * Create the CSRF `state` and the URL the browser must visit.
   * @returns {{ state: string, authorizationUrl: string, cookieOptions: object }}
   * @throws {Error} code `INVALID_CONFIG` when the OAuth App is not configured
   */
  function beginAuth() {
    const gh = getGithubConfig();
    if (!gh.clientId) {
      const err = new Error('GitHub OAuth App is not configured (set GITHUB_CLIENT_ID).');
      err.code = 'INVALID_CONFIG';
      throw err;
    }
    const state = crypto.randomBytes(32).toString('hex');
    pruneStates(Date.now());
    states.set(state, Date.now() + STATE_TTL_MS);
    const params = new URLSearchParams({
      client_id: gh.clientId,
      redirect_uri: gh.callbackUrl,
      scope: gh.scopes,
      state,
    });
    return {
      state,
      authorizationUrl: `${gh.authorizeUrl}?${params.toString()}`,
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
   * Verify a `state` against the server-side store (CSRF gate).
   * Successful verification consumes the state — each state is single-use.
   * @param {string} state
   * @returns {boolean}
   */
  function verifyState(state) {
    if (typeof state !== 'string' || state.length === 0) {
      return false;
    }
    const expiresAt = states.get(state);
    if (expiresAt === undefined || expiresAt <= Date.now()) {
      states.delete(state);
      return false;
    }
    states.delete(state);
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
