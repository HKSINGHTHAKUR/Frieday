/**
 * T3.1 DB-backed model tests (unique-identity dedupe, cross-user isolation).
 *
 * Follows the established DB-gated pattern (see syncModels.test.js): connect
 * with a short timeout, and skip with an explicit reason when MongoDB is
 * unavailable. These tests assert real database behavior — unique-index
 * enforcement (E11000) and user-scoped query isolation — which cannot be
 * verified without a live database.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Repository = require('../src/models/Repository');
const Commit = require('../src/models/Commit');

const oid = () => new mongoose.Types.ObjectId();
const PROVENANCE = { fetchedAt: new Date(), source: 'rest' };

function validRepo(overrides = {}) {
  return {
    userId: oid(),
    githubId: 42,
    owner: 'octo',
    name: 'demo',
    fullName: 'octo/demo',
    visibility: 'public',
    ...PROVENANCE,
    ...overrides,
  };
}

function validCommit(overrides = {}) {
  return {
    userId: oid(),
    sha: 'abc123',
    repoId: oid(),
    authoredAt: new Date(),
    ...PROVENANCE,
    ...overrides,
  };
}

/**
 * Cross-user isolation helper (tasks.md T3.1): seeds two users' rows in
 * `model` and asserts a user-scoped query returns only the caller's rows.
 */
async function assertUserScoped(t, dbUp, Model, makeDoc) {
  if (!dbUp) {
    t.skip('requires MongoDB (unavailable in this environment)');
    return;
  }
  const a = oid();
  const b = oid();
  await Model.deleteMany({ userId: { $in: [a, b] } });
  await Model.create([makeDoc(a, 1), makeDoc(a, 2), makeDoc(b, 1)]);
  const found = await Model.find({ userId: a }).lean();
  assert.equal(found.length, 2);
  assert.ok(
    found.every((d) => String(d.userId) === String(a)),
    'a user-scoped query must only return own rows'
  );
  await Model.deleteMany({ userId: { $in: [a, b] } });
}

describe('T3.1 models (DB-backed)', () => {
  let dbUp = false;

  before(async () => {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/frieday_test_models', {
        serverSelectionTimeoutMS: 3000,
      });
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  after(async () => {
    if (dbUp) {
      await Repository.deleteMany({}).catch(() => {});
      await Commit.deleteMany({}).catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }
  });

  it('duplicate repository upserts do not create duplicates', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = oid();
    const key = { userId, githubId: 777 };
    await Repository.updateOne({ ...key }, { $set: { ...validRepo(), ...key } }, { upsert: true });
    await assert.rejects(
      Repository.create({ ...validRepo(), ...key }),
      (err) => err && err.code === 11000,
      'a second insert with the same identity must hit the unique index'
    );
    assert.equal(await Repository.countDocuments({ userId }), 1);
    await Repository.deleteMany({ userId });
  });

  it('duplicate commit upserts do not create duplicates', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const userId = oid();
    const repoId = oid();
    const key = { userId, sha: 'dup-sha', repoId };
    await Commit.updateOne({ ...key }, { $set: { ...validCommit(), ...key } }, { upsert: true });
    await assert.rejects(Commit.create({ ...validCommit(), ...key }), (err) => err && err.code === 11000);
    assert.equal(await Commit.countDocuments({ userId }), 1);
    await Commit.deleteMany({ userId });
  });

  it('isolates repositories per user', async (t) => {
    await assertUserScoped(t, dbUp, Repository, (userId, i) => ({
      ...validRepo(),
      userId,
      githubId: 1000 + i,
    }));
  });

  it('isolates commits per user', async (t) => {
    await assertUserScoped(t, dbUp, Commit, (userId, i) => ({ ...validCommit(), userId, sha: `sha-${i}` }));
  });
});
