/**
 * Insight model (architecture.md §6, prd.md F8) — one stored deterministic
 * insight with its metrics and evidence references.
 *
 * Derived data, never hand-edited: the Phase 4 template engine (fixed
 * priority, max ~8 per range) creates these from raw collections, and the
 * recompute path wipes and rebuilds them. Evidence references point at
 * stable raw identities (repository ObjectIds, commit SHAs, PR numbers,
 * bucket start dates) so every insight stays resolvable after recompute.
 *
 * `metrics` is intentionally Mixed: its validated shape belongs to each
 * insight template (explicit review note per rules.md §1 — the Phase 4
 * `insights.js` engine owns the per-template shapes, not this schema).
 * `text` carries a 2000-character safety bound (rules.md §9 storage-bomb
 * hygiene for stored free text); template copy itself is far shorter.
 */
const mongoose = require('mongoose');

const RANGES = ['30d', '90d', '12m'];
const CONFIDENCE = ['High', 'Medium', 'Low'];

const evidenceSchema = new mongoose.Schema(
  {
    repoIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Repository' }], default: [] },
    commitShas: { type: [String], default: [] },
    prNumbers: { type: [Number], default: [] },
    bucketStarts: { type: [Date], default: [] },
  },
  { _id: false }
);

const insightSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    range: { type: String, enum: RANGES, required: true },
    templateId: { type: String, required: true, trim: true },
    // repoId is set for per-repo insights (e.g. project_health) so that
    // multiple insights of the same templateId can coexist, keyed by repo.
    // Null for aggregate templates (one doc per user/range/templateId).
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', default: null },
    generatedAt: { type: Date, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    evidence: { type: evidenceSchema, default: () => ({}) },
    confidence: { type: String, enum: CONFIDENCE, required: true },
  },
  {
    timestamps: true,
    bufferCommands: false,
  }
);

// Generation identity: one row per (user, range, templateId) for aggregate
// templates, plus one per (user, range, templateId, repoId) for per-repo
// insights (e.g. project_health). generatedAt is provenance only.
insightSchema.index({ userId: 1, range: 1, templateId: 1, repoId: 1 }, { unique: true });

const Insight = mongoose.model('Insight', insightSchema);

module.exports = Insight;
module.exports.RANGES = RANGES;
module.exports.CONFIDENCE = CONFIDENCE;
