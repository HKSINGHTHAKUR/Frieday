/**
 * Sync persistence primitives (T2.3) — the Mongoose implementation.
 *
 * Thin wrappers over the SyncJob/SyncState/User models: every query is
 * user-scoped, every write is minimal and atomic, and everything returned is
 * a lean plain object (no Mongoose documents cross this boundary, so the
 * in-memory fake used in tests can mirror the shapes exactly).
 *
 * Higher-level flows (claim, stale-reap, prune) compose these primitives in
 * `sync.service.js`. The only concurrency primitive that MUST be MongoDB
 * itself is the single-flight claim, enforced by SyncJob's partial unique
 * index: a second active job for the same user fails with a duplicate-key
 * error (code 11000), which the service maps to 409 SYNC_CONFLICT.
 */

const SyncJob = require('../../models/SyncJob');
const SyncState = require('../../models/SyncState');
const User = require('../../models/User');
const Repository = require('../../models/Repository');

const ACTIVE_STATUSES = ['queued', 'running'];
const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'];

/** Normalize a lean job doc to the plain shape shared with the fake store. */
function toJobShape(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    userId: doc.userId,
    kind: doc.kind,
    status: doc.status,
    progress: doc.progress
      ? { phase: doc.progress.phase, done: doc.progress.done, total: doc.progress.total }
      : null,
    perResource: doc.perResource ?? null,
    counts: doc.counts ?? null,
    startedAt: doc.startedAt ?? null,
    finishedAt: doc.finishedAt ?? null,
    error: doc.error ?? null,
    errorCode: doc.errorCode ?? null,
    resumeAt: doc.resumeAt ?? null,
    createdAt: doc.createdAt ?? null,
  };
}

/** Normalize a lean state doc to the plain shape shared with the fake store. */
function toStateShape(doc) {
  if (!doc) return null;
  return {
    resource: doc.resource,
    status: doc.status,
    lastSyncedAt: doc.lastSyncedAt ?? null,
    cursor: doc.cursor ?? null,
    error: doc.error ?? null,
  };
}

async function findActiveJob(userId) {
  const doc = await SyncJob.findOne({ userId, status: { $in: ACTIVE_STATUSES } })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return toJobShape(doc);
}

async function createJob({ userId, kind, progress, startedAt }) {
  // Duplicate-key (E11000) on the partial unique index means another active
  // job exists — it propagates to the service, which maps it to 409.
  const doc = await SyncJob.create({
    userId,
    kind,
    status: 'running',
    progress: progress ?? { phase: 'repositories', done: 0, total: 1 },
    startedAt: startedAt ?? new Date(),
  });
  return toJobShape(doc.toObject());
}

/**
 * Finish a job only while it is still active (compare-and-set). Returns the
 * updated job, or null when someone else already finished it (e.g. a stale
 * reaper) — the caller must not overwrite terminal state in that case.
 */
async function finishJobCAS(jobId, patch) {
  const doc = await SyncJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ACTIVE_STATUSES } },
    { $set: { ...patch, finishedAt: new Date() } },
    { new: true }
  )
    .lean()
    .exec();
  return toJobShape(doc);
}

async function getLatestJob(userId) {
  const doc = await SyncJob.findOne({ userId }).sort({ createdAt: -1 }).lean().exec();
  return toJobShape(doc);
}

async function getLatestFinishedJob(userId) {
  const doc = await SyncJob.findOne({ userId, status: { $in: TERMINAL_STATUSES } })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return toJobShape(doc);
}

async function listHistory(userId, limit = 20) {
  const docs = await SyncJob.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean().exec();
  return docs.map(toJobShape);
}

async function countJobs(userId) {
  return SyncJob.countDocuments({ userId }).exec();
}

async function deleteJobsExcept(userId, keepIds) {
  const keep = new Set((keepIds ?? []).map(String));
  const all = await SyncJob.find({ userId }).select('_id').lean().exec();
  const drop = all.map((d) => d._id).filter((id) => !keep.has(String(id)));
  if (drop.length === 0) return 0;
  const result = await SyncJob.deleteMany({ _id: { $in: drop } }).exec();
  return result.deletedCount ?? 0;
}

async function getStates(userId) {
  const docs = await SyncState.find({ userId }).lean().exec();
  const map = new Map();
  for (const doc of docs) map.set(doc.resource, toStateShape(doc));
  return map;
}

/**
 * Canonical overall last-synced timestamp (architecture.md §15): the most
 * recent SyncState resource `lastSyncedAt`. A resource's `lastSyncedAt` only
 * advances on a successful persist, so a failed sync never becomes "last
 * successful". Returns null when nothing has ever synced.
 * @param {Array<{lastSyncedAt: Date|null}>} states
 * @returns {Date|null}
 */
function overallLastSyncedAt(states) {
  return states.reduce((max, s) => (s.lastSyncedAt > max ? s.lastSyncedAt : max), null);
}

/**
 * Most recent successful sync timestamp for a user, read from SyncState.
 * Includes webhook/incremental updates (which advance SyncState but not the
 * User.lastSyncedAt full-resync marker), so the value never appears older
 * than an individual resource sync.
 * @param {string} userId
 * @param {{ model?: import('mongoose').Model }} [opts] - injectable for tests
 * @returns {Promise<Date|null>}
 */
async function getLastSyncedAt(userId, { model = SyncState } = {}) {
  const states = await model.find({ userId }).select('lastSyncedAt').lean().exec();
  return overallLastSyncedAt(states);
}

async function saveState(userId, resource, patch) {
  await SyncState.updateOne({ userId, resource }, { $set: patch }, { upsert: true }).exec();
}

async function saveProgress(jobId, progress) {
  await SyncJob.updateOne({ _id: jobId }, { $set: { progress } }).exec();
}

async function markUserSynced(userId, date) {
  await User.updateOne({ _id: userId }, { $set: { lastSyncedAt: date ?? new Date() } }).exec();
}

/**
 * Stamp a single repository's sync boundary (T7.2). `Repository.lastSyncedAt`
 * is the per-repo incremental boundary (`since = lastSyncedAt` on webhook
 * ingest) — a full sync stamps it via the repositories persist path, while
 * single-repo incremental ingest stamps it here.
 */
async function markRepoSynced(userId, githubId, date) {
  await Repository.updateOne({ userId, githubId }, { $set: { lastSyncedAt: date ?? new Date() } }).exec();
}

module.exports = {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  toJobShape,
  toStateShape,
  findActiveJob,
  createJob,
  finishJobCAS,
  getLatestJob,
  getLatestFinishedJob,
  listHistory,
  countJobs,
  deleteJobsExcept,
  getStates,
  getLastSyncedAt,
  overallLastSyncedAt,
  saveState,
  saveProgress,
  markUserSynced,
  markRepoSynced,
};
