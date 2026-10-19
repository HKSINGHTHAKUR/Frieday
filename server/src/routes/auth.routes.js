/**
 * Auth routes (architecture.md §5, §7). Thin: validate → service → shape.
 * No token material ever reaches the client (rules.md §7).
 *
 * Session model (T1.2): HS256 JWT cookies (`fd_access` 15 min,
 * `fd_refresh` 7-day rotation). Session validity is persisted on the user
 * document (sessionId + refresh hash), so logout/disconnect/reuse detection
 * take effect immediately.
 */
const { Router } = require('express');
const mongoose = require('mongoose');
const { createOAuthService } = require('../services/auth/oauth.service');
const { encryptToken, decryptToken } = require('../services/auth/crypto.service');
const session = require('../services/auth/session.service');
const { revokeGrant } = require('../services/github/revoke');
const { getLastSyncedAt } = require('../services/sync/sync.store');
const { startSync } = require('../services/sync/sync.service');
const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth');

const router = Router();
const oauth = createOAuthService();

// User-scoped data collections (architecture.md §6, §18: "All user-scoped
// queries include userId"). Raw collection access: the T3.1 models do not
// exist yet, and deleting from a not-yet-created collection is a safe no-op.
const USER_DATA_COLLECTIONS = [
  'repositories',
  'commits',
  'pullrequests',
  'issues',
  'languagesnapshots',
  'activitybuckets',
  'insights',
  'syncstates',
  'syncjobs',
];

/** Set (or clear) both session cookies with the shared flags. */
function setSessionCookies(res, accessToken, refreshToken, clearing) {
  const opts = session.sessionCookieOptions();
  const base = { httpOnly: true, sameSite: 'lax', secure: opts.secure, path: '/' };
  if (clearing) {
    res.clearCookie('fd_access', base);
    res.clearCookie('fd_refresh', base);
    return;
  }
  res.cookie('fd_access', accessToken, { ...base, maxAge: opts.maxAge });
  res.cookie('fd_refresh', refreshToken, { ...base, maxAge: opts.refreshMaxAge });
}

/**
 * GET /api/auth/github — start the OAuth flow.
 * Sets the httpOnly CSRF `state` cookie and redirects to GitHub.
 */
router.get('/github', (req, res) => {
  let started;
  try {
    started = oauth.beginAuth();
  } catch (err) {
    req.log.warn({ reqId: req.id, code: err.code ?? 'INVALID_CONFIG', operation: 'oauth-begin' });
    return res.status(501).json({
      error: { code: 'INVALID_CONFIG', message: 'GitHub connection is not configured.', retryable: false },
    });
  }
  res.cookie('fd_oauth_state', started.cookieValue, started.cookieOptions);
  req.log.info({ reqId: req.id, msg: 'oauth authorize redirect' });
  res.redirect(started.authorizationUrl);
});

/**
 * GET /api/auth/github/callback?code&state — complete the flow.
 * State mismatch/missing → 403 (no token exchange). Denied → /login?error=denied.
 * Exchange failure → /login?error=exchange_failed. DB unavailable →
 * /login?error=db_unavailable (session state cannot be persisted, so a session
 * must not be issued — it could never be verified). Success → session cookies
 * + 302 to /dashboard?connected=1 (architecture.md §7).
 */
router.get('/github/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  // CSRF gate (rules.md §7, architecture.md §7): the state must be present in
  // BOTH the query string and the httpOnly cookie (which an attacker cannot
  // read), must match, and must be a valid, unexpired, unconsumed signed token.
  const cookieValue = typeof req.cookies.fd_oauth_state === 'string' ? req.cookies.fd_oauth_state : '';
  if (state.length === 0 || state !== cookieValue.split(':')[0] || !oauth.verifyState(state, cookieValue)) {
    req.log.warn({ reqId: req.id, code: 'FORBIDDEN', message: 'oauth state verification failed' });
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Invalid or expired OAuth state. Try again.', retryable: false },
    });
  }
  // State consumed — clear the httpOnly state cookie. It is single-use and
  // must not linger after the callback.
  res.clearCookie('fd_oauth_state', { httpOnly: true, sameSite: 'lax', path: '/api/auth' });
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (code.length === 0) {
    req.log.warn({ reqId: req.id, code: 'FORBIDDEN', message: 'oauth callback without code' });
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Invalid or expired OAuth state. Try again.', retryable: false },
    });
  }

  let exchanged;
  try {
    exchanged = await oauth.exchange(code);
  } catch (err) {
    req.log.warn({ reqId: req.id, code: err.code ?? 'GITHUB_UNREACHABLE', operation: 'oauth-exchange' });
    const reason = err.code === 'UNAUTHENTICATED' ? 'denied' : 'exchange_failed';
    return res.redirect(`/login?error=${reason}`);
  }

  let profile;
  try {
    profile = await oauth.fetchProfile(exchanged.accessToken);
  } catch {
    req.log.warn({ reqId: req.id, code: 'GITHUB_UNREACHABLE', operation: 'oauth-profile' });
    return res.redirect('/login?error=exchange_failed');
  }

  let issued;
  try {
    const user = await oauth.upsertUser({
      githubId: profile.githubId,
      login: profile.login,
      avatarUrl: profile.avatarUrl,
      profileUrl: profile.profileUrl,
      token: encryptToken(exchanged.accessToken),
      scopes: exchanged.scopes,
    });
    issued = session.issueSession(user.githubId, user.login, exchanged.scopes);
    await session.persistSession(user.githubId, issued);
  } catch {
    req.log.warn({
      reqId: req.id,
      code: 'DB_UNAVAILABLE',
      message: 'login not persisted',
      operation: 'login-persist',
    });
    return res.redirect('/login?error=db_unavailable');
  }

  req.log.info({
    reqId: req.id,
    msg: 'oauth login complete',
    login: profile.login,
    githubId: profile.githubId,
  });
  setSessionCookies(res, issued.accessToken, issued.refreshToken, false);

  // Trigger initial sync in background (non-blocking). Do not delay the OAuth
  // redirect; sync failures are logged and surfaced via sync status.
  const userDocForSync = await User.findOne({ githubId: profile.githubId }).select('_id').lean();
  if (userDocForSync) {
    startSync(userDocForSync._id, { kind: 'initial' }).catch((err) => {
      req.log.warn({
        reqId: req.id,
        code: err && typeof err.code === 'string' && err.code.length > 0 ? err.code : 'INTERNAL',
        operation: 'initial-sync',
      });
    });
  }

  res.redirect('/dashboard?connected=1');
});

/**
 * GET /api/auth/me — current user + connection status (architecture.md §5).
 * Response: `{ user: { login, avatarUrl, ... }, connected, lastSyncedAt }`.
 * `lastSyncedAt` is the canonical overall value = most recent successful
 * SyncState resource sync (architecture.md §15), so webhook/incremental
 * updates are never hidden behind the older User.lastSyncedAt full-resync
 * marker.
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const lastSyncedAt = await getLastSyncedAt(req.user.id);
    res.json({
      user: {
        githubId: req.user.githubId,
        login: req.user.login,
        avatarUrl: req.user.avatarUrl,
        profileUrl: req.user.profileUrl,
        scopes: req.user.scopes,
      },
      connected: req.user.hasStoredToken,
      lastSyncedAt,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/auth/refresh — rotate the session (architecture.md §13:
 * `fd_refresh` 7-day rotation; prd.md: "7-day refresh rotation").
 *
 * The presented refresh token must (a) be a valid HS256 refresh JWT and
 * (b) hash-match the persisted session. Any mismatch — including a replay
 * of an already-rotated token — invalidates the whole session: the user must
 * sign in again. On success the access + refresh pair is reissued under the
 * same session id (sliding 7-day window) and both cookies are re-set.
 *
 * NOTE: required by tasks.md T1.2 ("7d refresh rotation") but missing from
 * the architecture.md §5 endpoint table — flagged to the docs owner.
 */
router.post('/refresh', async (req, res) => {
  const token = req.cookies && req.cookies.fd_refresh;
  const claims = session.verifyRefresh(token);
  if (!claims) {
    req.log.warn({ reqId: req.id, code: 'UNAUTHENTICATED', message: 'invalid refresh token' });
    setSessionCookies(res, null, null, true);
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Session expired. Sign in again.', retryable: false },
    });
  }

  let doc;
  try {
    doc = await User.findOne({ githubId: claims.githubId })
      .select('sessionId +refreshTokenHash login scopes')
      .lean();
  } catch {
    // err.message may embed driver/connection details — safe metadata only.
    req.log.warn({ reqId: req.id, code: 'DB_UNAVAILABLE', operation: 'refresh-lookup' });
    return res.status(503).json({
      error: {
        code: 'INTERNAL',
        message: 'Session verification is temporarily unavailable. Try again shortly.',
        retryable: true,
      },
    });
  }

  if (!doc || doc.sessionId !== claims.sid || doc.refreshTokenHash !== session.refreshHash(token)) {
    // Replayed/rotated token, stale cookie from a replaced session, or no
    // persisted session: kill the session and force a fresh sign-in.
    req.log.warn({
      reqId: req.id,
      code: 'REFRESH_REUSE',
      message: 'refresh token rejected; session invalidated',
    });
    try {
      await session.invalidatePersistedSession(claims.githubId);
    } catch {
      // Best-effort: the 401 below still clears the cookies.
    }
    setSessionCookies(res, null, null, true);
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Session expired. Sign in again.', retryable: false },
    });
  }

  const issued = session.issueSession(
    claims.githubId,
    doc.login,
    Array.isArray(doc.scopes) ? doc.scopes : [],
    claims.sid
  );
  try {
    await session.persistRotation(claims.githubId, issued);
  } catch {
    req.log.warn({ reqId: req.id, code: 'DB_UNAVAILABLE', operation: 'rotation-persist' });
    return res.status(503).json({
      error: {
        code: 'INTERNAL',
        message: 'Session verification is temporarily unavailable. Try again shortly.',
        retryable: true,
      },
    });
  }
  setSessionCookies(res, issued.accessToken, issued.refreshToken, false);
  res.json({ ok: true });
});

/**
 * POST /api/auth/logout — end the session (architecture.md §5): invalidate
 * the persisted session, clear both cookies. 204.
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await session.invalidatePersistedSession(req.user.githubId);
  } catch {
    // err.message may embed driver/connection details — safe metadata only.
    req.log.warn({ reqId: req.id, code: 'DB_UNAVAILABLE', operation: 'logout' });
    return res.status(503).json({
      error: {
        code: 'INTERNAL',
        message: 'Session verification is temporarily unavailable. Try again shortly.',
        retryable: true,
      },
    });
  }
  req.log.info({ reqId: req.id, msg: 'session logged out' });
  setSessionCookies(res, null, null, true);
  res.status(204).end();
});

/**
 * POST /api/auth/disconnect (architecture.md §5, prd.md Journey D):
 * revoke the GitHub OAuth grant (best-effort — a revocation failure never
 * blocks the disconnect), clear the stored token, and end the session.
 * Synced data is RETAINED until DELETE /api/auth/data. 204.
 */
router.post('/disconnect', requireAuth, async (req, res) => {
  let tokenEnc;
  try {
    const doc = await User.findById(req.user.id).select('+githubTokenEnc').lean();
    tokenEnc = doc && doc.githubTokenEnc;
  } catch {
    // err.message may embed driver/connection details — safe metadata only.
    req.log.warn({ reqId: req.id, code: 'DB_UNAVAILABLE', operation: 'disconnect-lookup' });
    return res.status(503).json({
      error: {
        code: 'INTERNAL',
        message: 'Session verification is temporarily unavailable. Try again shortly.',
        retryable: true,
      },
    });
  }

  if (tokenEnc) {
    try {
      await revokeGrant(decryptToken(tokenEnc));
      req.log.info({ reqId: req.id, msg: 'github grant revoked' });
    } catch (err) {
      // Best-effort by contract: log, never surface to the client.
      req.log.warn({
        reqId: req.id,
        code: err.code === 'UNAUTHENTICATED' ? 'TOKEN_DECRYPTION_FAILED' : 'GITHUB_UNREACHABLE',
        message: 'github grant revocation skipped',
      });
    }
  }

  try {
    await User.updateOne(
      { githubId: req.user.githubId },
      { $set: { githubTokenEnc: null, sessionId: null, refreshTokenHash: null } }
    ).exec();
  } catch {
    // err.message may embed driver/connection details — safe metadata only.
    req.log.warn({ reqId: req.id, code: 'DB_UNAVAILABLE', operation: 'disconnect-clear' });
    return res.status(503).json({
      error: {
        code: 'INTERNAL',
        message: 'Session verification is temporarily unavailable. Try again shortly.',
        retryable: true,
      },
    });
  }

  req.log.info({ reqId: req.id, msg: 'user disconnected' });
  setSessionCookies(res, null, null, true);
  res.status(204).end();
});

/**
 * DELETE /api/auth/data (architecture.md §5, prd.md FR-11 / Journey D):
 * full wipe of all user-scoped synced + derived data, returning the accurate
 * per-collection delete counts: `{ deleted: { repos, commits, ... } }`.
 * The user document itself is removed too — reconnecting later starts from
 * scratch. 200 with the counts.
 */
router.delete('/data', requireAuth, async (req, res) => {
  let deleted;
  try {
    const db = mongoose.connection.db;
    deleted = {};
    for (const name of USER_DATA_COLLECTIONS) {
      const result = await db.collection(name).deleteMany({ userId: req.user.id });
      deleted[name] = result.deletedCount;
    }
    const userResult = await User.deleteOne({ githubId: req.user.githubId });
    deleted.users = userResult.deletedCount;
  } catch {
    // Partial wipes are safe to retry: nothing recreated the deleted rows,
    // and the remaining deleteMany calls simply report lower counts.
    // err.message may embed driver/connection details — safe metadata only.
    req.log.warn({ reqId: req.id, code: 'DB_UNAVAILABLE', operation: 'delete-data' });
    return res.status(503).json({
      error: {
        code: 'INTERNAL',
        message: 'Deleting your data is temporarily unavailable. Try again shortly.',
        retryable: true,
      },
    });
  }

  req.log.info({ reqId: req.id, msg: 'user data deleted', deleted });
  setSessionCookies(res, null, null, true);
  res.json({ deleted });
});

module.exports = router;
