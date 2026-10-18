/**
 * Normalization persistence (T3.2) — normalized documents → MongoDB.
 *
 * Composition: `normalizeBatch` runs the per-resource normalizers (invalid
 * DTOs become reported entries, never silent skips); `persistBatch` writes
 * one resource's documents with timestamp-guarded bulk upserts;
 * `persistFetched` composes both for the orchestrator; `loadRepoIdMap`
 * resolves GitHub repository ids to Mongo ObjectIds once per run.
 *
 * Write shape per document (bulkWrite, ordered:false, bounded chunks):
 *  1. guarded `$set` of content — only when the incoming comparison
 *     timestamp is strictly newer than the stored one (newer-wins; equal or
 *     older input never overwrites, which also keeps repeated syncs
 *     byte-stable). Skipped when the incoming comparison value is null.
 *  2. `$setOnInsert` full document with `upsert: true` — inserts new rows;
 *     a no-op for rows that already exist.
 *  3. unconditional `lastSyncedAt` touch for every identity in the batch.
 *
 * Every op filters by the full unique identity and only ever updates or
 * upserts (never blind-inserts), so concurrent replays serialize instead of
 * colliding — duplicate-key races are structurally impossible by design.
 * Any reported write error is recorded per document with a sanitized
 * message (never raw driver text).
 *
 * LanguageSnapshot history-cap pruning (owner decision): 50 snapshots
 * per user + repository. Older snapshots beyond the cap are pruned on
 * the write path after a languages batch is persisted.
 */
const Repository = require('../../models/Repository');
const Commit = require('../../models/Commit');
const PullRequest = require('../../models/PullRequest');
const Issue = require('../../models/Issue');
const LanguageSnapshot = require('../../models/LanguageSnapshot');
const { normalizeRepository } = require('./normalize.repos');
const { normalizeCommit } = require('./normalize.commits');
const { normalizePullRequest } = require('./normalize.pulls');
const { normalizeIssue } = require('./normalize.issues');
const { normalizeLanguages } = require('./normalize.languages');

const CHUNK_DOCS = 500;
const LANG_HISTORY_CAP = 50;

const MODELS = {
  repositories: Repository,
  commits: Commit,
  pulls: PullRequest,
  issues: Issue,
  languages: LanguageSnapshot,
};

// Per-resource write contract: stable identity keys, the freshness
// comparison field (`compare: null` skips the guarded write — used where the
// identity itself carries the timestamp, e.g. LanguageSnapshot fetchedAt),
// and the normalizer for the resource.
const RESOURCES = {
  repositories: {
    Model: Repository,
    identity: ['githubId'],
    compare: 'githubUpdatedAt',
    normalize: normalizeRepository,
  },
  commits: { Model: Commit, identity: ['sha', 'repoId'], compare: 'authoredAt', normalize: normalizeCommit },
  pulls: {
    Model: PullRequest,
    identity: ['repoId', 'number'],
    compare: 'updatedAt',
    normalize: normalizePullRequest,
  },
  issues: { Model: Issue, identity: ['repoId', 'number'], compare: 'updatedAt', normalize: normalizeIssue },
  languages: {
    Model: LanguageSnapshot,
    identity: ['repoId', 'fetchedAt'],
    compare: null,
    normalize: normalizeLanguages,
  },
};

function identityFilter(userId, identityKeys, doc) {
  const filter = { userId };
  for (const key of identityKeys) filter[key] = doc[key];
  return filter;
}

function identityDesc(identityKeys, doc) {
  return identityKeys.map((key) => `${key}:${String(doc[key])}`).join(',');
}

function omitKeys(doc, keys) {
  const omitted = new Set(keys);
  const out = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!omitted.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Normalize a batch of DTOs, collecting per-item failures instead of
 * aborting the batch. Never mutates the input DTOs.
 */
function normalizeBatch(resource, dtos, ctx = {}) {
  const entry = RESOURCES[resource];
  if (!entry) {
    throw validationErrorFor(`Unknown resource: ${resource}.`);
  }
  const docs = [];
  const invalid = [];
  const list = Array.isArray(dtos) ? dtos : [];
  list.forEach((dto, index) => {
    try {
      docs.push(entry.normalize(dto, ctx));
    } catch (err) {
      invalid.push({
        index,
        key: describeDto(resource, entry.identity, dto),
        message: err && err.message ? err.message : 'Invalid record.',
        code: (err && err.code) || 'VALIDATION_ERROR',
      });
    }
  });
  return { docs, invalid };
}

function describeDto(resource, identityKeys, dto) {
  if (!dto || typeof dto !== 'object') return `${resource}:<malformed>`;
  return `${resource}:${identityKeys.map((k) => String(dto[k] ?? '?')).join('#')}`;
}

function validationErrorFor(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.retryable = false;
  return err;
}

/**
 * Persist already-normalized documents with guarded bulk upserts.
 * `Models` is injectable (fake models assert op shapes without a database).
 */
async function persistBatch({ Model, identityKeys, compareKey, docs, now, chunkDocs = CHUNK_DOCS }) {
  const writeErrors = [];
  for (let start = 0; start < docs.length; start += chunkDocs) {
    const chunk = docs.slice(start, start + chunkDocs);
    const ops = [];
    const owners = [];
    for (const doc of chunk) {
      const filter = identityFilter(doc.userId, identityKeys, doc);
      const compareValue = compareKey ? doc[compareKey] : null;
      if (compareKey && compareValue !== null && compareValue !== undefined) {
        ops.push({
          updateOne: {
            filter: { ...filter, [compareKey]: { $lt: compareValue } },
            update: { $set: omitKeys(doc, ['userId', ...identityKeys, 'createdAt', 'lastSyncedAt']) },
          },
        });
        owners.push(doc);
      }
      ops.push({ updateOne: { filter, update: { $setOnInsert: { ...doc, createdAt: now } }, upsert: true } });
      owners.push(doc);
      ops.push({ updateOne: { filter, update: { $set: { lastSyncedAt: now } } } });
      owners.push(doc);
    }
    if (ops.length === 0) continue;
    try {
      await Model.bulkWrite(ops, { ordered: false });
    } catch (err) {
      // ordered:false: independent ops still applied; only the failed ops
      // are itemized here (BulkWriteError.writeErrors). A throw WITHOUT
      // itemized errors means the batch outcome is unknown (transport
      // failure) — rethrow, never fake success.
      const list = err && (err.writeErrors ?? err.errors);
      if (!Array.isArray(list)) throw err;
      for (const item of list) {
        const detail = (item && item.err) || item || {};
        const owner = owners[item && Number.isInteger(item.index) ? item.index : -1];
        const key = owner ? identityDesc(identityKeys, owner) : '<unknown>';
        writeErrors.push({
          key,
          code: 'INTERNAL',
          message: `Bulk write failed for ${key}.`,
          mongoCode: detail.code,
        });
      }
    }
  }
  const failedKeys = new Set(writeErrors.map((w) => w.key));
  return { persisted: docs.length - failedKeys.size, writeErrors };
}

async function loadRepoIdMap(userId, githubIds, Model = Repository) {
  const ids = [...new Set((githubIds ?? []).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return new Map();
  const rows = await Model.find({ userId, githubId: { $in: ids } })
    .select('_id githubId')
    .lean()
    .exec();
  const map = new Map();
  for (const row of rows) map.set(row.githubId, row._id);
  return map;
}

/**
 * Prune LanguageSnapshot history to the cap per (userId, repoId).
 * Keeps the newest `cap` snapshots by fetchedAt; older ones are deleted.
 * Called after a languages batch is persisted.
 */
async function pruneLanguageHistory(userId, cap = LANG_HISTORY_CAP) {
  // Find all distinct repoIds for this user that have snapshots
  const repoIds = await LanguageSnapshot.distinct('repoId', { userId });
  if (repoIds.length === 0) return;
  // For each repo, find snapshots beyond the cap and delete them
  for (const repoId of repoIds) {
    // Cutoff = the newest snapshot still inside the cap (index cap-1, 0-based).
    // Everything strictly older than it is deleted, leaving exactly `cap`.
    const cutoffDocs = await LanguageSnapshot.find({ userId, repoId })
      .sort({ fetchedAt: -1 })
      .skip(cap - 1)
      .limit(1)
      .select('fetchedAt')
      .lean()
      .exec();
    if (cutoffDocs.length === 0) continue; // at or below cap
    const cutoff = cutoffDocs[0].fetchedAt;
    await LanguageSnapshot.deleteMany({ userId, repoId, fetchedAt: { $lt: cutoff } }).exec();
  }
}

/**
 * Full per-resource persist flow for the orchestrator: normalize a batch of
 * fetcher DTOs, then bulk-write the valid documents. Returns counts plus
 * per-item failures; throws only when persistence itself is unreachable.
 */
async function persistFetched(
  userId,
  resource,
  dtos,
  { userLogin = null, repoIdMap = null, now = null, Models = MODELS } = {}
) {
  const entry = RESOURCES[resource];
  if (!entry) {
    throw validationErrorFor(`Unknown resource: ${resource}.`);
  }
  const at = now ?? new Date();
  const { docs, invalid } = normalizeBatch(resource, dtos ?? [], { userId, userLogin, repoIdMap });
  if (docs.length === 0) {
    return { persisted: 0, invalid, writeErrors: [] };
  }
  const Model = Models[resource];
  if (!Model || typeof Model.bulkWrite !== 'function') {
    throw validationErrorFor(`No persistence model for resource: ${resource}.`);
  }
  const { persisted, writeErrors } = await persistBatch({
    Model,
    identityKeys: entry.identity,
    compareKey: entry.compare,
    docs,
    now: at,
  });
  // Prune LanguageSnapshot history after a languages batch is persisted
  if (resource === 'languages') {
    await pruneLanguageHistory(userId);
  }
  return { persisted, invalid, writeErrors };
}

module.exports = {
  CHUNK_DOCS,
  LANG_HISTORY_CAP,
  MODELS,
  RESOURCES,
  normalizeBatch,
  persistBatch,
  loadRepoIdMap,
  persistFetched,
  pruneLanguageHistory,
};
