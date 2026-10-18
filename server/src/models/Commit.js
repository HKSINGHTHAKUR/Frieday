/**
 * Commit model (architecture.md §6, prd.md §16) — one document per GitHub
 * commit authored in a synced repository.
 *
 * Identity is the compound (userId, sha, repoId): repeated syncs upsert the
 * same document, never duplicates (rules.md §6). `authoredAt` is required —
 * it is the sort key for every timeline query, and a missing author date
 * from GitHub must fail loudly at the write boundary rather than silently
 * break ordering. `author`/`committer` stay null when GitHub attaches no
 * user (never invent one).
 *
 * Truncation bounds mirror the T3.2 normalizer contract (tasks.md T3.2):
 * headline ≤120ch, full message ≤500ch, file list ≤50 paths (enforced here
 * as a second layer so oversized payloads can never reach storage).
 */
const mongoose = require('mongoose');

const SOURCES = ['rest', 'webhook'];

const gitHubUserSchema = new mongoose.Schema(
  {
    login: { type: String, trim: true, default: null },
    id: { type: Number, default: null },
    avatarUrl: { type: String, trim: true, default: null },
  },
  { _id: false }
);

function maxArrayLength(limit) {
  return [
    {
      validator: (arr) => !Array.isArray(arr) || arr.length <= limit,
      message: `array exceeds the ${limit}-item storage bound`,
    },
  ];
}

const commitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sha: { type: String, required: true, trim: true },
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true },
    messageHeadline: { type: String, trim: true, maxlength: 120, default: null },
    messageFull: { type: String, trim: true, maxlength: 500, default: null },
    authoredAt: { type: Date, required: true },
    committedAt: { type: Date, default: null },
    author: { type: gitHubUserSchema, default: null },
    committer: { type: gitHubUserSchema, default: null },
    additions: { type: Number, min: 0, default: 0 },
    deletions: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
    files: { type: [String], default: [], validate: maxArrayLength(50) },
    parents: { type: [String], default: [] },
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

// Upsert identity (rules.md §6): one row per (user, commit, repo).
commitSchema.index({ userId: 1, sha: 1, repoId: 1 }, { unique: true });
// Timeline sort path (tasks.md T3.1): newest-first reads per user.
commitSchema.index({ userId: 1, authoredAt: -1 });

const Commit = mongoose.model('Commit', commitSchema);

module.exports = Commit;
module.exports.SOURCES = SOURCES;
