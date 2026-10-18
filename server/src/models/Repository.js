/**
 * Repository model (architecture.md §6, prd.md §16) — one document per
 * GitHub repository accessible to a user.
 *
 * Identity is the compound (userId, githubId): repeated syncs upsert the
 * same document, never duplicates (rules.md §6). `lastSyncedAt` is stamped
 * by the T3.2 write path; `fetchedAt` + `source` provenance is required on
 * every write (rules.md §11 — data without provenance is rejected).
 *
 * Field notes:
 * - `visibility` uses GitHub's full domain (public/private/internal); the
 *   T2.2 DTO derives public/private from the `private` flag.
 * - `pushedAt`/`archived`/`description`/URLs/topics/license are DTO metadata
 *   kept for Phase 4/5 (project health, repo detail); all are nullable or
 *   defaulted, never invented.
 */
const mongoose = require('mongoose');

const VISIBILITY = ['public', 'private', 'internal'];
const SOURCES = ['rest', 'webhook'];

const licenseSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, default: null },
    name: { type: String, trim: true, default: null },
    spdxId: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const repositorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    githubId: { type: Number, required: true },
    owner: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    visibility: { type: String, enum: VISIBILITY, required: true },
    primaryLanguage: { type: String, trim: true, default: null },
    stars: { type: Number, min: 0, default: 0 },
    fork: { type: Boolean, default: false },
    defaultBranch: { type: String, trim: true, default: null },
    githubUpdatedAt: { type: Date, default: null },
    pushedAt: { type: Date, default: null },
    archived: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    description: { type: String, trim: true, maxlength: 500, default: null },
    htmlUrl: { type: String, trim: true, default: null },
    cloneUrl: { type: String, trim: true, default: null },
    sshUrl: { type: String, trim: true, default: null },
    homepage: { type: String, trim: true, default: null },
    topics: { type: [String], default: [] },
    license: { type: licenseSchema, default: null },
    lastSyncedAt: { type: Date, default: null },
    // Provenance (rules.md §11): always set by the T3.2 write path from the
    // fetcher DTO; required so unprovenanced rows can never be written.
    fetchedAt: { type: Date, required: true },
    source: { type: String, enum: SOURCES, required: true },
  },
  {
    timestamps: true,
    bufferCommands: false,
  }
);

// Upsert identity (rules.md §6): one row per (user, GitHub repo).
repositorySchema.index({ userId: 1, githubId: 1 }, { unique: true });

const Repository = mongoose.model('Repository', repositorySchema);

module.exports = Repository;
module.exports.VISIBILITY = VISIBILITY;
module.exports.SOURCES = SOURCES;
