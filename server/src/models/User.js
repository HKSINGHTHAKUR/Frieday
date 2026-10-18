/**
 * User model (architecture.md §6). One document per connected GitHub account.
 *
 * `githubTokenEnc` — AES-256-GCM payload from services/auth/crypto.service.js
 * (key: TOKEN_ENC_KEY); never a raw token. Nullable: `null` after a
 * disconnect clears the stored token (architecture.md §5), until the next
 * login re-upserts it.
 *
 * Session state (T1.2): `sessionId` + `refreshTokenHash` (SHA-256 of the
 * current refresh JWT — the raw token is never stored) back rotation,
 * reuse detection, and immediate invalidation on logout/disconnect.
 */
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    githubId: { type: Number, required: true, unique: true },
    login: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    profileUrl: { type: String, default: null },
    githubTokenEnc: { type: String, default: null, select: false },
    tokenUpdatedAt: { type: Date, default: () => new Date() },
    scopes: { type: [String], default: [] },
    // Set by the sync orchestrator on completion (Phase 2); exposed in /api/auth/me.
    lastSyncedAt: { type: Date, default: null },
    // Current session id (hex). Null = no live session (never logged in, or
    // invalidated by logout/disconnect/refresh-reuse detection).
    sessionId: { type: String, default: null },
    refreshTokenHash: { type: String, default: null, select: false },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    // Fail fast when the database is unavailable instead of buffering for
    // bufferTimeoutMS — the login callback surfaces db_unavailable to the
    // login page (session state is persisted, so a degraded session cannot
    // be verified later).
    bufferCommands: false,
  }
);

const User = mongoose.model('User', userSchema);

/**
 * Insert-or-update the connected user after an OAuth token exchange.
 * Idempotent: re-syncing refreshes the token + identity fields only.
 * @param {object} record `{ githubId, login, avatarUrl, profileUrl, token (encrypted payload), scopes }`
 * @returns {Promise<{ githubId: number, login: string }>} the upserted document (lean)
 * @throws {Error} `GITHUB_UNREACHABLE` when the database is unavailable
 */
User.upsertOne = async function upsertOne(record) {
  const result = await this.updateOne(
    { githubId: record.githubId },
    {
      $set: {
        login: record.login,
        avatarUrl: record.avatarUrl,
        profileUrl: record.profileUrl,
        githubTokenEnc: record.token,
        tokenUpdatedAt: new Date(),
        scopes: record.scopes,
      },
    },
    { upsert: true }
  ).exec();
  if (result.acknowledged === false) {
    const err = new Error('Database unavailable');
    err.code = 'GITHUB_UNREACHABLE';
    err.retryable = true;
    throw err;
  }
  const doc = await this.findOne({ githubId: record.githubId }).lean().exec();
  return { githubId: doc.githubId, login: doc.login };
};

module.exports = User;
