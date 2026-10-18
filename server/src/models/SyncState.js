/**
 * SyncState model (architecture.md §6) — per-user, per-resource sync state.
 *
 * Owns cursor + provenance state ONLY (tasks.md T2.1): which page/ETag/SHA a
 * fetcher resumed from, when the resource last synced, and the last error.
 * In-flight job/progress state belongs to SyncJob — do not duplicate it here.
 *
 * `cursor` is resource-specific pagination state (page numbers, ETags, SHAs).
 * It is intentionally `Mixed`: the shape is owned by the T2.2 fetchers, which
 * validate it at the boundary (explicit review note per rules.md §1 — no
 * schema here would be invented ahead of the fetchers).
 *
 * Rate-limit cooldowns are in-memory only (architecture.md §12) — they must
 * NOT be persisted here; `status: 'rate_limited'` records the fact + the
 * resume time is derived from GitHub's limit headers at the time of the
 * pause, and re-derived on resume.
 */
const mongoose = require('mongoose');

const RESOURCES = ['repositories', 'commits', 'pulls', 'issues', 'languages'];
const STATUSES = ['idle', 'rate_limited', 'failed', 'done'];

const syncStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    resource: { type: String, enum: RESOURCES, required: true },
    lastSyncedAt: { type: Date, default: null },
    // 'idle' — never synced (or reset), 'rate_limited' — paused on a GitHub
    // limit, 'failed' — last sync errored (see `error`), 'done' — last sync
    // of this resource completed successfully.
    status: { type: String, enum: STATUSES, default: 'idle' },
    // Resource-specific pagination state (T2.2 fetchers own the shape).
    cursor: { type: mongoose.Schema.Types.Mixed, default: null },
    // Short error message only (architecture.md §6); no stack traces.
    error: { type: String, trim: true, maxlength: 200, default: null },
  },
  {
    timestamps: true,
    // Fail fast when the database is unavailable (consistent with User).
    bufferCommands: false,
  }
);

// One state document per (user, resource) — the sync identity (architecture.md §6).
syncStateSchema.index({ userId: 1, resource: 1 }, { unique: true });

const SyncState = mongoose.model('SyncState', syncStateSchema);

module.exports = SyncState;
module.exports.RESOURCES = RESOURCES;
module.exports.STATUSES = STATUSES;
