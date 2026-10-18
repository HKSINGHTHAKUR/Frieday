/**
 * Persistence tests (T3.2) — bulk upsert machinery with fake models (no
 * database), plus DB-gated idempotency / timestamp-guard / race tests
 * against real MongoDB (skipped with reason when unavailable).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { persistBatch, persistFetched, loadRepoIdMap } = require('../src/services/normalization/persist');
const Commit = require('../src/models/Commit');

const USER_ID = new mongoose.Types.ObjectId();

/** Fake Mongoose model: records bulkWrite calls, behavior scriptable. */
function fakeModel({ failIndexes = new Map(), transportError = null } = {}) {
  const calls = [];
  return {
    calls,
    async bulkWrite(ops, options) {
      calls.push({ ops, options });
      if (transportError) throw transportError;
      const writeErrors = [];
      for (const [index] of ops.entries()) {
        if (failIndexes.has(index)) {
          writeErrors.push({ index, code: failIndexes.get(index), errmsg: 'injected failure' });
        }
      }
      if (writeErrors.length > 0) {
        const err = new Error('bulk write failed');
        err.writeErrors = writeErrors;
        throw err;
      }
      return { ok: 1 };
    },
  };
}

function commitDoc(i, overrides = {}) {
  return {
    userId: USER_ID,
    sha: `sha-${i}`,
    repoId: new mongoose.Types.ObjectId(),
    messageHeadline: `Commit ${i}`,
    messageFull: `Commit ${i}`,
    authoredAt: new Date('2024-01-15T00:00:00Z'),
    fetchedAt: new Date('2024-02-01T00:00:00Z'),
    source: 'rest',
    lastSyncedAt: null,
    ...overrides,
  };
}

describe('persistBatch (T3.2, no DB)', () => {
  it('writes nothing and calls nothing for an empty batch', async () => {
    const Model = fakeModel();
    const out = await persistBatch({
      Model,
      identityKeys: ['sha'],
      compareKey: 'authoredAt',
      docs: [],
      now: new Date(),
    });
    assert.deepEqual(out, { persisted: 0, writeErrors: [] });
    assert.equal(Model.calls.length, 0);
  });

  it('builds guarded $set + $setOnInsert + touch ops per document', async () => {
    const Model = fakeModel();
    const at = new Date('2024-01-15T00:00:00Z');
    const now = new Date('2024-02-01T00:00:00Z');
    const out = await persistBatch({
      Model,
      identityKeys: ['sha'],
      compareKey: 'authoredAt',
      docs: [commitDoc(1, { authoredAt: at })],
      now,
    });
    assert.equal(out.persisted, 1);
    assert.deepEqual(out.writeErrors, []);
    assert.equal(Model.calls.length, 1);
    const [call] = Model.calls;
    assert.deepEqual(call.options, { ordered: false });
    assert.equal(call.ops.length, 3, 'guarded content + insert + touch');
    const [guarded, insert, touch] = call.ops;
    assert.deepEqual(guarded.updateOne.filter, {
      userId: USER_ID,
      sha: 'sha-1',
      authoredAt: { $lt: at },
    });
    assert.ok(!('upsert' in guarded.updateOne), 'guarded write must never insert');
    assert.ok(!('lastSyncedAt' in guarded.updateOne.update.$set), 'watermark touch is a separate op');
    assert.equal(insert.updateOne.upsert, true);
    assert.ok(insert.updateOne.update.$setOnInsert.createdAt instanceof Date);
    assert.deepEqual(touch.updateOne.update, { $set: { lastSyncedAt: now } });
  });

  it('skips the guarded write when the comparison value is null', async () => {
    const Model = fakeModel();
    await persistBatch({
      Model,
      identityKeys: ['sha'],
      compareKey: 'authoredAt',
      docs: [commitDoc(1, { authoredAt: null })],
      now: new Date(),
    });
    assert.equal(Model.calls[0].ops.length, 2, 'insert + touch only (nothing to compare)');
  });

  it('chunks large batches into bounded bulkWrite calls', async () => {
    const Model = fakeModel();
    const docs = Array.from({ length: 1200 }, (_, i) => commitDoc(i));
    const out = await persistBatch({
      Model,
      identityKeys: ['sha'],
      compareKey: 'authoredAt',
      docs,
      now: new Date(),
      chunkDocs: 500,
    });
    assert.equal(out.persisted, 1200);
    assert.equal(Model.calls.length, 3, '1200 docs in 500-doc chunks');
    assert.ok(
      Model.calls.every((c) => c.ops.length <= 1500),
      'no unbounded bulk array'
    );
  });

  it('records per-op failures without failing the batch', async () => {
    const Model = fakeModel({ failIndexes: new Map([[4, 121]]) });
    const docs = [commitDoc(1), commitDoc(2)];
    const out = await persistBatch({
      Model,
      identityKeys: ['sha'],
      compareKey: 'authoredAt',
      docs,
      now: new Date(),
    });
    assert.equal(out.persisted, 1);
    assert.equal(out.writeErrors.length, 1);
    assert.equal(out.writeErrors[0].code, 'INTERNAL');
    assert.equal(out.writeErrors[0].mongoCode, 121);
    assert.ok(!JSON.stringify(out).includes('injected failure'), 'no driver text in messages');
  });

  it('rethrows transport failures instead of faking success', async () => {
    const Model = fakeModel({ transportError: new Error('connection lost') });
    await assert.rejects(
      persistBatch({
        Model,
        identityKeys: ['sha'],
        compareKey: 'authoredAt',
        docs: [commitDoc(1)],
        now: new Date(),
      }),
      (err) => err.message === 'connection lost'
    );
  });
});

describe('persistFetched + loadRepoIdMap (T3.2, no DB)', () => {
  it('rejects unknown resources without touching the database', async () => {
    const Model = fakeModel();
    await assert.rejects(
      persistFetched('user', 'nope', [], { Models: { nope: Model } }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
    assert.equal(Model.calls.length, 0);
  });

  it('returns zeros without a bulk call when every DTO is invalid', async () => {
    const Model = fakeModel();
    const out = await persistFetched('user', 'commits', [null, { sha: '' }], {
      userLogin: null,
      repoIdMap: new Map(),
      Models: { commits: Model },
    });
    assert.equal(out.persisted, 0);
    assert.equal(out.invalid.length, 2);
    assert.equal(Model.calls.length, 0, 'nothing valid means no bulk call');
  });

  it('returns an empty map without querying for empty input', async () => {
    let queried = false;
    const Model = {
      find: () => {
        queried = true;
        throw new Error('must not query');
      },
    };
    const map = await loadRepoIdMap('user', [], Model);
    assert.equal(map.size, 0);
    assert.equal(queried, false);
  });
});

describe('persist (DB-backed)', () => {
  let dbUp = false;

  before(async () => {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/frieday_test_persist', {
        serverSelectionTimeoutMS: 3000,
      });
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  after(async () => {
    if (dbUp) {
      await Commit.deleteMany({}).catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }
  });

  it('bulk upserts are idempotent across repeated runs', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    const dtos = [0, 1, 2].map((i) => ({
      sha: `idem-${i}`,
      repoId: '4242',
      messageHeadline: `Commit ${i}`,
      messageFull: `Commit ${i}`,
      authoredAt: new Date('2024-01-15T00:00:00Z'),
      fetchedAt: new Date('2024-02-01T00:00:00Z'),
      source: 'rest',
    }));
    const first = await persistFetched(userId, 'commits', dtos, { userLogin: null, repoIdMap: map });
    assert.equal(first.persisted, 3);
    assert.equal(await Commit.countDocuments({ userId }), 3);
    const second = await persistFetched(userId, 'commits', dtos, { userLogin: null, repoIdMap: map });
    assert.equal(second.persisted, 3);
    assert.equal(await Commit.countDocuments({ userId }), 3, 'reruns must not duplicate');
    await Commit.deleteMany({ userId });
  });

  it('newer data wins over older data, never the reverse (out-of-order)', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    const base = {
      sha: 'guarded-sha',
      repoId: '4242',
      messageHeadline: 'H',
      messageFull: 'F',
      fetchedAt: new Date('2024-02-01T00:00:00Z'),
      source: 'rest',
    };
    await persistFetched(userId, 'commits', [{ ...base, authoredAt: new Date('2024-01-20T00:00:00Z') }], {
      userLogin: null,
      repoIdMap: map,
    });
    // Older delivery arrives later: must not overwrite.
    await persistFetched(userId, 'commits', [{ ...base, authoredAt: new Date('2024-01-10T00:00:00Z') }], {
      userLogin: null,
      repoIdMap: map,
    });
    let doc = await Commit.findOne({ userId, sha: 'guarded-sha' }).lean();
    assert.equal(doc.authoredAt.getTime(), new Date('2024-01-20T00:00:00Z').getTime());
    // Newer delivery updates.
    await persistFetched(userId, 'commits', [{ ...base, authoredAt: new Date('2024-01-25T00:00:00Z') }], {
      userLogin: null,
      repoIdMap: map,
    });
    doc = await Commit.findOne({ userId, sha: 'guarded-sha' }).lean();
    assert.equal(doc.authoredAt.getTime(), new Date('2024-01-25T00:00:00Z').getTime());
    assert.equal(await Commit.countDocuments({ userId }), 1);
    await Commit.deleteMany({ userId });
  });

  it('concurrent duplicate batches converge without corruption', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    const dtos = [0, 1, 2].map((i) => ({
      sha: `race-${i}`,
      repoId: '4242',
      messageHeadline: `Commit ${i}`,
      messageFull: `Commit ${i}`,
      authoredAt: new Date('2024-01-15T00:00:00Z'),
      fetchedAt: new Date('2024-02-01T00:00:00Z'),
      source: 'rest',
    }));
    const results = await Promise.all([
      persistFetched(userId, 'commits', dtos, { userLogin: null, repoIdMap: map }),
      persistFetched(userId, 'commits', dtos, { userLogin: null, repoIdMap: map }),
    ]);
    assert.ok(results.every((r) => r.persisted === 3));
    assert.equal(await Commit.countDocuments({ userId }), 3, 'concurrent replays must not duplicate');
    await Commit.deleteMany({ userId });
  });
});

describe('LanguageSnapshot history cap (T3.2)', () => {
  const LanguageSnapshot = require('../src/models/LanguageSnapshot');
  const { persistFetched, pruneLanguageHistory } = require('../src/services/normalization/persist');

  let dbUp = false;

  before(async () => {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/frieday_test_persist', {
        serverSelectionTimeoutMS: 3000,
      });
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  after(async () => {
    if (dbUp) {
      await LanguageSnapshot.deleteMany({}).catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }
  });

  it('below cap (49 snapshots): no pruning occurs', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    // Insert 49 snapshots
    const dtos = Array.from({ length: 49 }, (_, i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'TypeScript', bytes: 100 + i }],
      source: 'rest',
    }));
    const out = await persistFetched(userId, 'languages', dtos, { userLogin: null, repoIdMap: map });
    assert.equal(out.persisted, 49);
    const count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 49, 'all 49 snapshots retained when below cap');
    await LanguageSnapshot.deleteMany({ userId });
  });

  it('exact cap (50 snapshots): no pruning occurs', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    const dtos = Array.from({ length: 50 }, (_, i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'TypeScript', bytes: 100 + i }],
      source: 'rest',
    }));
    const out = await persistFetched(userId, 'languages', dtos, { userLogin: null, repoIdMap: map });
    assert.equal(out.persisted, 50);
    const count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 50, 'all 50 snapshots retained at exact cap');
    await LanguageSnapshot.deleteMany({ userId });
  });

  it('above cap (51 snapshots): oldest snapshot is removed', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    // Insert 51 snapshots with increasing fetchedAt
    const dtos = Array.from({ length: 51 }, (_, i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'TypeScript', bytes: 100 + i }],
      source: 'rest',
    }));
    const out = await persistFetched(userId, 'languages', dtos, { userLogin: null, repoIdMap: map });
    assert.equal(out.persisted, 51);
    const count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 50, 'only 50 snapshots retained after pruning');
    // Verify the oldest (Jan 1) was pruned, newest 50 (Jan 2-51) remain
    const oldest = await LanguageSnapshot.findOne({ userId, repoId }).sort({ fetchedAt: 1 }).lean();
    assert.equal(oldest.fetchedAt.getTime(), new Date('2024-01-02T00:00:00Z').getTime());
    const newest = await LanguageSnapshot.findOne({ userId, repoId }).sort({ fetchedAt: -1 }).lean();
    assert.equal(newest.fetchedAt.getTime(), new Date(Date.UTC(2024, 0, 51)).getTime());
    await LanguageSnapshot.deleteMany({ userId });
  });

  it('multiple repositories: only the over-cap repo is pruned', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoA = new mongoose.Types.ObjectId();
    const repoB = new mongoose.Types.ObjectId();
    const map = new Map([
      [4242, repoA],
      [4243, repoB],
    ]);
    // Repo A: 51 snapshots (over cap)
    const dtosA = Array.from({ length: 51 }, (_, i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'TypeScript', bytes: 100 + i }],
      source: 'rest',
    }));
    // Repo B: 30 snapshots (under cap)
    const dtosB = Array.from({ length: 30 }, (_, i) => ({
      repoId: '4243',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'Python', bytes: 200 + i }],
      source: 'rest',
    }));
    await persistFetched(userId, 'languages', dtosA, { userLogin: null, repoIdMap: map });
    await persistFetched(userId, 'languages', dtosB, { userLogin: null, repoIdMap: map });
    const countA = await LanguageSnapshot.countDocuments({ userId, repoId: repoA });
    const countB = await LanguageSnapshot.countDocuments({ userId, repoId: repoB });
    assert.equal(countA, 50, 'Repo A pruned to 50');
    assert.equal(countB, 30, 'Repo B unchanged at 30');
    await LanguageSnapshot.deleteMany({ userId });
  });

  it('multiple users: only the over-cap user is pruned', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    // User A: 51 snapshots (over cap)
    const dtosA = Array.from({ length: 51 }, (_, i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'TypeScript', bytes: 100 + i }],
      source: 'rest',
    }));
    // User B: 30 snapshots (under cap)
    const dtosB = Array.from({ length: 30 }, (_, i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'Python', bytes: 200 + i }],
      source: 'rest',
    }));
    await persistFetched(userA, 'languages', dtosA, { userLogin: null, repoIdMap: map });
    await persistFetched(userB, 'languages', dtosB, { userLogin: null, repoIdMap: map });
    const countA = await LanguageSnapshot.countDocuments({ userId: userA, repoId });
    const countB = await LanguageSnapshot.countDocuments({ userId: userB, repoId });
    assert.equal(countA, 50, 'User A pruned to 50');
    assert.equal(countB, 30, 'User B unchanged at 30');
    await LanguageSnapshot.deleteMany({ userId: userA });
    await LanguageSnapshot.deleteMany({ userId: userB });
  });

  it('ordering: newest 50 survive even if insertion order differs', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    // Insert in random order (not chronological)
    const shuffled = Array.from({ length: 55 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    const dtos = shuffled.map((i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, i)),
      languages: [{ language: 'TypeScript', bytes: 100 + i }],
      source: 'rest',
    }));
    await persistFetched(userId, 'languages', dtos, { userLogin: null, repoIdMap: map });
    const count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 50, 'only 50 retained regardless of insertion order');
    // Verify the retained snapshots are the 50 with latest fetchedAt (days 6-55)
    const docs = await LanguageSnapshot.find({ userId, repoId }).sort({ fetchedAt: 1 }).lean();
    assert.equal(docs[0].fetchedAt.getTime(), new Date('2024-01-06T00:00:00Z').getTime());
    assert.equal(docs[49].fetchedAt.getTime(), new Date(Date.UTC(2024, 0, 55)).getTime());
    await LanguageSnapshot.deleteMany({ userId });
  });

  it('idempotency: persisting same snapshot twice does not incorrectly trigger pruning', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    // Insert exactly 50 unique snapshots
    const dtos = Array.from({ length: 50 }, (_, i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'TypeScript', bytes: 100 + i }],
      source: 'rest',
    }));
    await persistFetched(userId, 'languages', dtos, { userLogin: null, repoIdMap: map });
    let count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 50);
    // Re-persist the exact same 50 snapshots
    await persistFetched(userId, 'languages', dtos, { userLogin: null, repoIdMap: map });
    count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 50, 're-persisting same data must not change count');
    // Now add one new snapshot (day 51) - should prune day 1
    const newDto = [
      {
        repoId: '4242',
        fetchedAt: new Date(Date.UTC(2024, 0, 51)),
        languages: [{ language: 'TypeScript', bytes: 200 }],
        source: 'rest',
      },
    ];
    await persistFetched(userId, 'languages', newDto, { userLogin: null, repoIdMap: map });
    count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 50, 'adding 51st unique snapshot prunes oldest');
    const oldest = await LanguageSnapshot.findOne({ userId, repoId }).sort({ fetchedAt: 1 }).lean();
    assert.equal(oldest.fetchedAt.getTime(), new Date('2024-01-02T00:00:00Z').getTime());
    await LanguageSnapshot.deleteMany({ userId });
  });

  it('provenance and normalization remain intact after pruning', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    const map = new Map([[4242, repoId]]);
    const dtos = Array.from({ length: 51 }, (_, i) => ({
      repoId: '4242',
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      languages: [{ language: 'TypeScript', bytes: 100 + i }],
      source: 'rest',
    }));
    await persistFetched(userId, 'languages', dtos, { userLogin: null, repoIdMap: map });
    const docs = await LanguageSnapshot.find({ userId, repoId }).lean();
    assert.equal(docs.length, 50);
    for (const doc of docs) {
      assert.ok(doc.userId.equals(userId));
      assert.ok(doc.repoId.equals(repoId));
      assert.ok(doc.fetchedAt instanceof Date);
      assert.ok(typeof doc.bytes === 'object');
      assert.equal(doc.source, 'rest');
      assert.ok(doc.createdAt instanceof Date);
      assert.ok(doc.updatedAt instanceof Date);
    }
    await LanguageSnapshot.deleteMany({ userId });
  });

  it('pruneLanguageHistory function works standalone', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = new mongoose.Types.ObjectId();
    const repoId = new mongoose.Types.ObjectId();
    // Manually insert 55 snapshots via model
    const docs = Array.from({ length: 55 }, (_, i) => ({
      userId,
      repoId,
      fetchedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      bytes: { TypeScript: 100 + i },
      source: 'rest',
    }));
    await LanguageSnapshot.insertMany(docs);
    let count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 55);
    // Call prune directly
    await pruneLanguageHistory(userId);
    count = await LanguageSnapshot.countDocuments({ userId, repoId });
    assert.equal(count, 50, 'standalone prune reduces to cap');
    const oldest = await LanguageSnapshot.findOne({ userId, repoId }).sort({ fetchedAt: 1 }).lean();
    assert.equal(oldest.fetchedAt.getTime(), new Date('2024-01-06T00:00:00Z').getTime());
    await LanguageSnapshot.deleteMany({ userId });
  });
});
