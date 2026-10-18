/**
 * ActivityBucket model (architecture.md §6) — pre-computed per-bucket
 * activity counters for fast dashboard reads.
 *
 * Derived data, never hand-edited (architecture.md §6): the Phase 4
 * recompute path wipes and rebuilds these rows from raw collections.
 * `repoId` is null for user-aggregate buckets and set for per-repo buckets;
 * MongoDB treats the missing value as null inside the unique index, so at
 * most one aggregate bucket exists per (user, range, granularity, bucket start).
 *
 * `range` follows the API allowlist (rules.md §5: 30d|90d|12m). `granularity`
 * (day|week) is part of the bucket identity so day and week buckets for the
 * same range are never mixed or reused across incompatible granularities
 * (prd.md §9 F4: 30d = day, 90d/12m = week). No fetchedAt/source here:
 * buckets are computed, not fetched (their time dimension is `bucketStart`).
 */
const mongoose = require('mongoose');

const RANGES = ['30d', '90d', '12m'];
const GRANULARITIES = ['day', 'week'];

const activityBucketSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    range: { type: String, enum: RANGES, required: true },
    granularity: { type: String, enum: GRANULARITIES, required: true },
    bucketStart: { type: Date, required: true },
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', default: null },
    commits: { type: Number, min: 0, default: 0 },
    prsOpened: { type: Number, min: 0, default: 0 },
    prsMerged: { type: Number, min: 0, default: 0 },
    issuesTouched: { type: Number, min: 0, default: 0 },
  },
  {
    timestamps: true,
    bufferCommands: false,
  }
);

// Bucket identity: one aggregate (repoId null) or one per-repo row per
// (user, range, granularity, bucket start).
activityBucketSchema.index(
  { userId: 1, range: 1, granularity: 1, bucketStart: 1, repoId: 1 },
  { unique: true }
);

const ActivityBucket = mongoose.model('ActivityBucket', activityBucketSchema);

module.exports = ActivityBucket;
module.exports.RANGES = RANGES;
module.exports.GRANULARITIES = GRANULARITIES;
