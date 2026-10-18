/**
 * Issue model (architecture.md §6, prd.md §16) — one document per GitHub
 * issue in a synced repository (pull requests are stored as PullRequests,
 * never here — the T2.2 fetcher filters them out).
 *
 * Identity is the compound (userId, repoId, number): repeated syncs upsert
 * the same document, never duplicates (rules.md §6). `authorLogin` plus
 * `isAuthoredByUser` are architecture §6 fields computed by the T3.2
 * normalizer. Title bound ≤200ch mirrors the T3.2 normalizer contract.
 * Labels keep the T2.2 DTO shape ({ name, color, description }) because
 * name + color drive Phase 5 display and evidence grouping.
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

const labelSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: null },
    color: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const milestoneSchema = new mongoose.Schema(
  {
    number: { type: Number, default: null },
    title: { type: String, trim: true, default: null },
    state: { type: String, trim: true, default: null },
    dueOn: { type: Date, default: null },
  },
  { _id: false }
);

const issueSchema = new mongoose.Schema(
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
    author: { type: gitHubUserSchema, default: null },
    authorLogin: { type: String, trim: true, default: null },
    isAuthoredByUser: { type: Boolean, default: false },
    authorAssociation: { type: String, trim: true, default: null },
    assignees: { type: [gitHubUserSchema], default: [] },
    labels: { type: [labelSchema], default: [] },
    comments: { type: Number, min: 0, default: 0 },
    locked: { type: Boolean, default: false },
    milestone: { type: milestoneSchema, default: null },
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

// Upsert identity (rules.md §6): one row per (user, repo, issue number).
issueSchema.index({ userId: 1, repoId: 1, number: 1 }, { unique: true });

const Issue = mongoose.model('Issue', issueSchema);

module.exports = Issue;
module.exports.STATES = STATES;
module.exports.SOURCES = SOURCES;
