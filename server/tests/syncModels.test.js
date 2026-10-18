/**
 * SyncState + SyncJob model tests (tasks.md T2.1).
 *
 * Schema-level validation (required fields, enums, progress shape, declared
 * indexes) runs with NO database. Mongo-dependent behavior (unique identity,
 * cursor upsert, cross-user scoping, job persistence) follows the established
 * DB-gated pattern: skip with an explicit reason when MongoDB is unavailable.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const SyncState = require('../src/models/SyncState');
const SyncJob = require('../src/models/SyncJob');

describe('SyncState model (schema level, no DB)', () => {
  it('requires userId and resource', async () => {
    await assert.rejects(new SyncState({ resource: 'commits' }).validate());
    await assert.rejects(new SyncState({ userId: new mongoose.Types.ObjectId() }).validate());
  });

  it('rejects unknown resource and status enum values', async () => {
    const oid = new mongoose.Types.ObjectId();
    await assert.rejects(new SyncState({ userId: oid, resource: 'bogus' }).validate());
    await assert.rejects(new SyncState({ userId: oid, resource: 'commits', status: 'bogus' }).validate());
  });

  it('accepts a complete document (incl. Mixed cursor)', async () => {
    await new SyncState({
      userId: new mongoose.Types.ObjectId(),
      resource: 'commits',
      status: 'rate_limited',
      cursor: { page: 2, etag: '"w"' },
      error: 'limit reached',
      lastSyncedAt: new Date(),
    }).validate();
  });

  it('declares the unique (userId, resource) index', () => {
    const indexes = SyncState.schema.indexes();
    assert.ok(
      indexes.some(([fields, opts]) => fields.userId === 1 && fields.resource === 1 && opts.unique === true),
      `unique compound index missing: ${JSON.stringify(indexes)}`
    );
  });
});

describe('SyncJob model (schema level, no DB)', () => {
  it('requires userId and kind and validates enums', async () => {
    const oid = new mongoose.Types.ObjectId();
    await assert.rejects(new SyncJob({ kind: 'initial' }).validate());
    await assert.rejects(new SyncJob({ userId: oid }).validate());
    await assert.rejects(new SyncJob({ userId: oid, kind: 'bogus' }).validate());
    await assert.rejects(new SyncJob({ userId: oid, kind: 'initial', status: 'bogus' }).validate());
  });

  it('rejects negative progress counters', async () => {
    await assert.rejects(
      new SyncJob({
        userId: new mongoose.Types.ObjectId(),
        kind: 'initial',
        progress: { done: -1 },
      }).validate()
    );
  });

  it('accepts a complete document (progress + perResource)', async () => {
    await new SyncJob({
      userId: new mongoose.Types.ObjectId(),
      kind: 'resync',
      status: 'running',
      progress: { phase: 'commits', done: 12, total: 500 },
      perResource: { commits: 'running', repositories: 'done' },
      startedAt: new Date(),
    }).validate();
  });

  it('declares the (userId, createdAt) history index', () => {
    const indexes = SyncJob.schema.indexes();
    assert.ok(
      indexes.some(([fields]) => fields.userId === 1 && fields.createdAt === -1),
      `history index missing: ${JSON.stringify(indexes)}`
    );
  });
});

describe('SyncState + SyncJob (DB-backed)', () => {
  let dbUp = false;

  before(async () => {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/frieday_test_sync_models', {
        serverSelectionTimeoutMS: 3000,
      });
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  after(async () => {
    if (dbUp) {
      await SyncState.deleteMany({}).catch(() => {});
      await SyncJob.deleteMany({}).catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }
  });

  it('enforces the unique (userId, resource) identity', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const a = new mongoose.Types.ObjectId();
    await SyncState.updateOne(
      { userId: a, resource: 'commits' },
      { $set: { status: 'idle' } },
      { upsert: true }
    );
    await SyncState.updateOne(
      { userId: a, resource: 'commits' },
      { $set: { status: 'done' } },
      { upsert: true }
    );
    assert.equal(await SyncState.countDocuments({ userId: a }), 1, 'a second upsert must not duplicate');
    assert.equal((await SyncState.findOne({ userId: a, resource: 'commits' })).status, 'done');
  });

  it('persists cursor + status + provenance on upsert', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const a = new mongoose.Types.ObjectId();
    const at = new Date();
    await SyncState.updateOne(
      { userId: a, resource: 'pulls' },
      {
        $set: {
          cursor: { page: 2, etag: '"w1"' },
          status: 'rate_limited',
          error: 'limit reached',
          lastSyncedAt: at,
        },
      },
      { upsert: true }
    );
    const doc = await SyncState.findOne({ userId: a, resource: 'pulls' }).lean();
    assert.equal(doc.cursor.page, 2);
    assert.equal(doc.status, 'rate_limited');
    assert.ok(doc.lastSyncedAt instanceof Date);
  });

  it('scopes SyncState queries to a single user (cross-user isolation)', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    await SyncState.deleteMany({});
    await SyncState.updateOne(
      { userId: a, resource: 'commits' },
      { $set: { status: 'done' } },
      { upsert: true }
    );
    await SyncState.updateOne(
      { userId: b, resource: 'commits' },
      { $set: { status: 'done' } },
      { upsert: true }
    );
    const forA = await SyncState.find({ userId: a }).lean();
    assert.equal(forA.length, 1);
    assert.ok(
      forA.every((d) => String(d.userId) === String(a)),
      'a query for user A must only return A documents'
    );
  });

  it('persists a SyncJob with progress state', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const job = await SyncJob.create({
      userId: new mongoose.Types.ObjectId(),
      kind: 'initial',
      status: 'running',
      progress: { phase: 'commits', done: 0, total: 10 },
      perResource: { commits: 'running' },
    });
    const found = await SyncJob.findById(job._id).lean();
    assert.equal(found.kind, 'initial');
    assert.equal(found.status, 'running');
    assert.equal(found.progress.total, 10);
  });
});
