/**
 * PullRequest model (architecture.md §6, prd.md §16) — one document per
 * GitHub pull request in a synced repository.
 *
 * Identity is the compound (userId, repoId, number): repeated syncs upsert
 * the same document, never duplicates (rules.md §6). `authorLogin` plus the
 * `isAuthoredByUser` / `isReviewedByUser` flags are architecture §6 fields
 * computed by the T3.2 normalizer from the stored author/reviewers (never
 * trust flags arriving from outside). Title bound ≤200ch mirrors the T3.2
 * normalizer contract.
 *
 * Deliberately NOT stored: GitHub's volatile `mergeable` / `mergeable_state`
 * flags. They are recomputed by GitHub on unrelated activity, so persisting
 * them would rewrite documents on every sync and break the Phase 3 DoD
 * (byte-stable repeated syncs). Everything else follows the T2.2 DTO shape.
 */
const mongoose = require('mongoose');

const STATES = ['open', 'closed'];
const SOURCES = ['rest', 'webhook'];

const gitHubUserSchema = new mongoose.Schema(
  {
    login: { type: String, trim: true, default: null },
    id: { type: Number, default: null },
    avatarUrl: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const slimRepoSchema = new mongoose.Schema(
  {
    id: { type: Number, default: null },
    fullName: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const pullRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true },
    number: { type: Number, required: true, min: 1 },
    state: { type: String, enum: STATES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, trim: true, maxlength: 500, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    mergedAt: { type: Date, default: null },
    author: { type: gitHubUserSchema, default: null },
    authorLogin: { type: String, trim: true, default: null },
    isAuthoredByUser: { type: Boolean, default: false },
    isReviewedByUser: { type: Boolean, default: false },
    authorAssociation: { type: String, trim: true, default: null },
    draft: { type: Boolean, default: false },
    additions: { type: Number, min: 0, default: 0 },
    deletions: { type: Number, min: 0, default: 0 },
    changedFiles: { type: Number, min: 0, default: 0 },
    commits: { type: Number, min: 0, default: 0 },
    comments: { type: Number, min: 0, default: 0 },
    reviewComments: { type: Number, min: 0, default: 0 },
    baseRef: { type: String, trim: true, default: null },
    baseSha: { type: String, trim: true, default: null },
    baseRepo: { type: slimRepoSchema, default: null },
    headRef: { type: String, trim: true, default: null },
    headSha: { type: String, trim: true, default: null },
    headRepo: { type: slimRepoSchema, default: null },
    merged: { type: Boolean, default: false },
    mergedBy: { type: gitHubUserSchema, default: null },
    requestedReviewers: { type: [gitHubUserSchema], default: [] },
    reviewers: { type: [gitHubUserSchema], default: [] },
    labels: { type: [String], default: [] },
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

// Upsert identity (rules.md §6): one row per (user, repo, PR number).
pullRequestSchema.index({ userId: 1, repoId: 1, number: 1 }, { unique: true });

const PullRequest = mongoose.model('PullRequest', pullRequestSchema);

module.exports = PullRequest;
module.exports.STATES = STATES;
module.exports.SOURCES = SOURCES;
