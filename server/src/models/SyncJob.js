/**
 * SyncJob model (architecture.md §6) — one document per sync run.
 *
 * Owns job + in-flight progress state ONLY (tasks.md T2.1): what kind of sync
 * ran, its overall status, the live progress snapshot (phase/done/total),
 * per-resource outcomes, and the error that ended it (if any). Per-resource
 * cursors + last-synced provenance belong to SyncState — do not duplicate
 * them here.
 *
 * `perResource` maps resource → status string (e.g.
 * { repositories: 'done', commits: 'failed' }). It is `Mixed` with a
 * documented contract: keys are SyncState.RESOURCES, values are short status
 * strings (explicit review note per rules.md §1). The T2.3 orchestrator uses
 * 'done' | 'failed' | 'skipped' | 'rate_limited' ('skipped' = already current
 * from a prior run, not refetched by this run).
 *
 * T2.3 additions (all optional, all additive — T2.1 fields untouched):
 * - `counts`: per-resource item counts fetched by the run (tasks.md T2.3
 *   expects "done with per-resource counts"; counts live here because
 *   resource DTOs themselves are not persisted until Phase 3).
 * - `errorCode`: machine-readable code for `error` (architecture.md §12
 *   envelope codes), so the status API can render retry/reconnect affordances.
 * - `resumeAt`: when a run ends rate-limited, the time GitHub allows resuming.
 * - Partial unique index on `userId` for active (`queued`/`running`) jobs:
 *   the race-safe single-flight claim (MongoDB rejects a second active job
 *   per user with a duplicate-key error, which T2.3 maps to 409 SYNC_CONFLICT).
 */
const mongoose = require('mongoose');

const KINDS = ['initial', 'resync', 'incremental'];
const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

const progressSchema = new mongoose.Schema(
  {
    // Current phase label (e.g. 'commits'); defined by the T2.3 orchestrator.
    phase: { type: String, trim: true, default: '' },
    done: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const syncJobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: KINDS, required: true },
    status: { type: String, enum: STATUSES, default: 'queued' },
    progress: { type: progressSchema, default: null },
    perResource: { type: mongoose.Schema.Types.Mixed, default: null },
    // Per-resource item counts for this run (T2.3); keys are SyncState.RESOURCES.
    counts: { type: mongoose.Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    // Short error message only (architecture.md §6); no stack traces.
    error: { type: String, trim: true, maxlength: 200, default: null },
    // Machine-readable code for `error` + resume time for rate-limited runs.
    errorCode: { type: String, trim: true, default: null },
    resumeAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Fail fast when the database is unavailable (consistent with User).
    bufferCommands: false,
  }
);

// History listings are user-scoped, newest first (architecture.md §6 index).
syncJobSchema.index({ userId: 1, createdAt: -1 });

// Single-flight claim (T2.3): at most one active (`queued`/`running`) job per
// user. The second concurrent insert fails with a duplicate-key error, which
// the sync service maps to 409 SYNC_CONFLICT. Terminal jobs are unaffected.
syncJobSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['queued', 'running'] } },
  }
);

const SyncJob = mongoose.model('SyncJob', syncJobSchema);

module.exports = SyncJob;
module.exports.KINDS = KINDS;
module.exports.STATUSES = STATUSES;
