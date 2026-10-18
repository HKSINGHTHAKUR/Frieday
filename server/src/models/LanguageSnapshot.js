/**
 * LanguageSnapshot model (architecture.md §6) — one document per
 * per-repository language byte map observed at a point in time.
 *
 * Identity is the compound (userId, repoId, fetchedAt): each observation is
 * a distinct row and repeated syncs upsert the same row, never duplicates
 * (rules.md §6). `bytes` is a Map per architecture §6 (the T3.2 normalizer
 * converts the T2.2 DTO's `[{ language, bytes }]` array into this shape).
 * History is capped at 50 snapshots per (userId, repoId) — enforced on the
 * write path (T3.2). Older snapshots are pruned after each languages batch.
 */
const mongoose = require('mongoose');

const SOURCES = ['rest', 'webhook'];

const languageSnapshotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true },
    fetchedAt: { type: Date, required: true },
    bytes: { type: Map, of: Number, default: {} },
    source: { type: String, enum: SOURCES, required: true },
  },
  {
    timestamps: true,
    bufferCommands: false,
  }
);

// Observation identity: one row per (user, repo, observation time).
languageSnapshotSchema.index({ userId: 1, repoId: 1, fetchedAt: 1 }, { unique: true });

const LanguageSnapshot = mongoose.model('LanguageSnapshot', languageSnapshotSchema);

module.exports = LanguageSnapshot;
module.exports.SOURCES = SOURCES;
