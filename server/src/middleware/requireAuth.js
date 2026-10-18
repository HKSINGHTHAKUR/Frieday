/**
 * Auth gate (rules.md §7, architecture.md §13). Trusts only the `fd_access`
 * cookie: an HS256 JWT (signature + expiry + typ) whose session id still
 * matches the persisted user session. A revoked session (logout, disconnect,
 * refresh reuse) fails immediately instead of living out its 15-min TTL.
 * No token material ever reaches responses or logs.
 */
const session = require('../services/auth/session.service');
const User = require('../models/User');

function unauthenticated(res, message, clearCookies) {
  if (clearCookies) {
    const opts = session.sessionCookieOptions();
    res.clearCookie('fd_access', { ...opts, maxAge: undefined });
    res.clearCookie('fd_refresh', { ...opts, maxAge: undefined });
  }
  return res.status(401).json({
    error: { code: 'UNAUTHENTICATED', message, retryable: false },
  });
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {(err?: unknown) => void} next
 */
function requireAuth(req, res, next) {
  const claims = session.verifyAccess(req.cookies && req.cookies.fd_access);
  if (!claims) {
    req.log.warn({ reqId: req.id, code: 'UNAUTHENTICATED', message: 'missing or invalid access token' });
    // Do not clear cookies here: an expired access token may still be rotated
    // by a valid fd_refresh via POST /api/auth/refresh.
    return unauthenticated(res, 'Authentication required.', false);
  }

  User.findOne({ githubId: claims.githubId })
    .select('sessionId login avatarUrl profileUrl scopes lastSyncedAt +githubTokenEnc')
    .lean()
    .then((doc) => {
      if (!doc || doc.sessionId !== claims.sid) {
        req.log.warn({ reqId: req.id, code: 'UNAUTHENTICATED', message: 'session invalidated' });
        return unauthenticated(res, 'Session expired. Sign in again.', true);
      }
      req.user = {
        id: doc._id,
        githubId: claims.githubId,
        sid: claims.sid,
        login: doc.login,
        avatarUrl: doc.avatarUrl,
        profileUrl: doc.profileUrl,
        scopes: Array.isArray(doc.scopes) ? doc.scopes : [],
        lastSyncedAt: doc.lastSyncedAt,
        hasStoredToken: doc.githubTokenEnc !== null && doc.githubTokenEnc !== undefined,
      };
      return next();
    })
    .catch(() => {
      // err.message may embed driver/connection details — safe metadata only.
      req.log.warn({ reqId: req.id, code: 'DB_UNAVAILABLE', operation: 'session-lookup' });
      return res.status(503).json({
        error: {
          code: 'INTERNAL',
          message: 'Session verification is temporarily unavailable. Try again shortly.',
          retryable: true,
        },
      });
    });
}

module.exports = requireAuth;
