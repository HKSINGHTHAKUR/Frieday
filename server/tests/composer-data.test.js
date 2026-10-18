/**
 * Regression tests for composer-data.js loadRawData (T4.3).
 *
 * Covers the fix for missing language data on the dashboard:
 * LanguageSnapshot documents must NOT be filtered by the activity date range
 * (fetchedAt), because they are repository metadata, not activity events.
 * computeLanguageAggregation already selects the latest snapshot per repo.
 *
 * Follows the established DB-gated pattern: connect with a short timeout,
 * and skip with an explicit reason when MongoDB is unavailable.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { loadRawData } = require('../src/services/intelligence/composer-data');

const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_REPO_ID = new mongoose.Types.ObjectId();

describe('loadRawData — language snapshots not filtered by fetchedAt range', () => {
  let dbUp = false;

  before(async () => {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/frieday_test_configdb', {
        serverSelectionTimeoutMS: 3000,
      });
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  after(async () => {
    if (dbUp) {
      await mongoose.connection.db
        .collection('languagesnapshots')
        .deleteMany({ userId: TEST_USER_ID })
        .catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }
  });

  async function insertSnapshot(db, fetchedAt, bytes = { Java: 1000 }) {
    await db.collection('languagesnapshots').insertOne({
      userId: TEST_USER_ID,
      repoId: TEST_REPO_ID,
      fetchedAt,
      bytes,
      source: 'rest',
    });
  }

  async function cleanDb(db) {
    await db.collection('languagesnapshots').deleteMany({ userId: TEST_USER_ID });
  }

  it('returns language snapshots fetched outside the activity window', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const db = mongoose.connection.db;
    await cleanDb(db);
    try {
      // Range: 30d ending at anchor (today midnight). Snapshots fetched today
      // after midnight are outside [rangeStart, anchor] but must still be
      // returned because they represent current repo language composition.
      const anchor = new Date('2026-10-17T00:00:00.000Z'); // today at midnight UTC
      const todayAfterMidnight = new Date('2026-10-17T11:28:00.000Z'); // after range end
      const yesterday = new Date('2026-10-16T11:28:00.000Z'); // inside range

      await insertSnapshot(db, todayAfterMidnight, { Java: 5000 });
      await insertSnapshot(db, yesterday, { Python: 3000 });

      const result = await loadRawData(TEST_USER_ID.toString(), '30d', anchor);

      const fetchedAtValues = result.languageSnapshots.map((s) => s.fetchedAt);
      assert.ok(fetchedAtValues.some((d) => d.getTime() === todayAfterMidnight.getTime()));
      assert.ok(fetchedAtValues.some((d) => d.getTime() === yesterday.getTime()));
      assert.strictEqual(result.languageSnapshots.length, 2);
    } finally {
      await cleanDb(db);
    }
  });

  it('returns language snapshots for the correct user only', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const db = mongoose.connection.db;
    await cleanDb(db);
    try {
      const anchor = new Date('2026-10-17T00:00:00.000Z');
      const otherUserId = new mongoose.Types.ObjectId();

      await insertSnapshot(db, new Date('2026-10-17T11:28:00.000Z'), { Java: 5000 });
      await db.collection('languagesnapshots').insertOne({
        userId: otherUserId,
        repoId: TEST_REPO_ID,
        fetchedAt: new Date('2026-10-17T11:28:00.000Z'),
        bytes: { Rust: 999 },
        source: 'rest',
      });

      const result = await loadRawData(TEST_USER_ID.toString(), '30d', anchor);

      assert.strictEqual(result.languageSnapshots.length, 1);
      assert.strictEqual(result.languageSnapshots[0].bytes.Java, 5000);
    } finally {
      await cleanDb(db);
    }
  });

  it('returns empty array when no language snapshots exist', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const db = mongoose.connection.db;
    await cleanDb(db);
    try {
      const anchor = new Date('2026-10-17T00:00:00.000Z');

      const result = await loadRawData(TEST_USER_ID.toString(), '30d', anchor);

      assert.deepStrictEqual(result.languageSnapshots, []);
    } finally {
      await cleanDb(db);
    }
  });

  it('includes snapshots fetched at exactly the range boundary', async (t) => {
    if (!dbUp) {
      t.skip('requires MongoDB (unavailable in this environment)');
      return;
    }
    const db = mongoose.connection.db;
    await cleanDb(db);
    try {
      const anchor = new Date('2026-10-17T00:00:00.000Z');
      const boundary = new Date('2026-09-18T00:00:00.000Z'); // rangeStart for 30d

      await insertSnapshot(db, boundary, { Go: 100 });

      const result = await loadRawData(TEST_USER_ID.toString(), '30d', anchor);

      assert.strictEqual(result.languageSnapshots.length, 1);
      assert.strictEqual(result.languageSnapshots[0].bytes.Go, 100);
    } finally {
      await cleanDb(db);
    }
  });
});
