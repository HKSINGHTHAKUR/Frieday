/**
 * Backup/restore integration tests (Item 1, Phase 9).
 *
 * These tests exercise the full backup → restore → verify flow against a
 * real MongoDB instance. They skip when no MongoDB is available locally.
 *
 * Uses synthetic data in a disposable `frieday_backup_drill_*` database.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const fs = require('node:fs');

const { execSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.resolve(process.cwd(), 'scripts/backup-restore.js');

const SOURCE_URI = 'mongodb://127.0.0.1:27017/frieday_backup_drill_source';
const TARGET_URI = 'mongodb://127.0.0.1:27017/frieday_backup_drill_target';
const BACKUP_DIR = path.join(require('node:os').tmpdir(), `frieday-backup-integration-${Date.now()}`);

let sourceClient;
let targetClient;

async function seedSyntheticData(db) {
  const collections = {
    users: [
      { _id: 'u1', githubId: 1001, login: 'synthetic-user', email: 'user@example.com' },
      { _id: 'u2', githubId: 1002, login: 'synthetic-user-2', email: 'user2@example.com' },
    ],
    repositories: [
      { _id: 'r1', githubId: 2001, name: 'synthetic/repo-one', userId: 'u1' },
      { _id: 'r2', githubId: 2002, name: 'synthetic/repo-two', userId: 'u1' },
      { _id: 'r3', githubId: 2003, name: 'synthetic/repo-three', userId: 'u2' },
    ],
    commits: [
      {
        _id: 'c1',
        sha: 'a'.repeat(40),
        repoId: 'r1',
        userId: 'u1',
        authoredAt: new Date('2026-09-01T00:00:00Z'),
        message: 'first commit',
      },
      {
        _id: 'c2',
        sha: 'b'.repeat(40),
        repoId: 'r1',
        userId: 'u1',
        authoredAt: new Date('2026-09-02T00:00:00Z'),
        message: 'second commit',
      },
      {
        _id: 'c3',
        sha: 'c'.repeat(40),
        repoId: 'r2',
        userId: 'u1',
        authoredAt: new Date('2026-09-03T00:00:00Z'),
        message: 'third commit',
      },
    ],
    pullrequests: [
      { _id: 'p1', number: 1, repoId: 'r1', userId: 'u1', title: 'Synthetic PR one' },
      { _id: 'p2', number: 2, repoId: 'r1', userId: 'u1', title: 'Synthetic PR two' },
    ],
    issues: [{ _id: 'i1', number: 10, repoId: 'r1', userId: 'u1', title: 'Synthetic issue one' }],
  };

  for (const [name, docs] of Object.entries(collections)) {
    if (docs.length > 0) {
      await db.collection(name).insertMany(docs, { ordered: false });
    }
  }
}

async function dropDb(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    await client.db(dbName).dropDatabase();
  } catch {
    // Ignore — database may not exist yet
  } finally {
    await client.close();
  }
}

describe('backup-restore: integration (Item 1)', () => {
  before(async () => {
    // Attempt to connect to MongoDB; skip the whole suite if unavailable.
    const probe = new MongoClient(SOURCE_URI, { serverSelectionTimeoutMS: 3000 });
    try {
      await probe.connect();
      await probe.close();
    } catch {
      // MongoDB not available — tests below will skip individually.
    }
  });

  it('is skipped when MongoDB is unavailable', async (t) => {
    const probe = new MongoClient(SOURCE_URI, { serverSelectionTimeoutMS: 3000 });
    try {
      await probe.connect();
      await probe.close();
    } catch {
      t.skip('MongoDB not available locally — backup/restore integration drill skipped');
    }
  });

  it('full drill: backup → restore → verify → cleanup', async (t) => {
    const probe = new MongoClient(SOURCE_URI, { serverSelectionTimeoutMS: 3000 });
    try {
      await probe.connect();
      await probe.close();
    } catch {
      t.skip('MongoDB not available locally — backup/restore integration drill skipped');
      return;
    }

    // Clean slate
    await dropDb(SOURCE_URI, 'frieday_backup_drill_source');
    await dropDb(TARGET_URI, 'frieday_backup_drill_target');

    // Seed synthetic data
    sourceClient = new MongoClient(SOURCE_URI, { serverSelectionTimeoutMS: 10000 });
    await sourceClient.connect();
    const sourceDb = sourceClient.db();
    await seedSyntheticData(sourceDb);

    // Record expected counts
    const expectedCounts = {};
    for (const name of ['users', 'repositories', 'commits', 'pullrequests', 'issues']) {
      expectedCounts[name] = await sourceDb.collection(name).countDocuments({});
    }

    // Phase 1: backup
    const backupResult = execSync(
      `node "${SCRIPT}" backup "${SOURCE_URI}" "${BACKUP_DIR}" frieday_backup_drill_source`,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    assert.ok(backupResult.includes('Backup complete'), `backup did not complete:\n${backupResult}`);

    // Verify backup files exist
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json'));
    assert.ok(files.includes('users.json'), 'users.json should exist in backup');
    assert.ok(files.includes('commits.json'), 'commits.json should exist in backup');

    // Phase 2: restore to temp database
    const restoreResult = execSync(
      `node "${SCRIPT}" restore "${TARGET_URI}" "${BACKUP_DIR}" frieday_backup_drill_target`,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    assert.ok(restoreResult.includes('Restore complete'), `restore did not complete:\n${restoreResult}`);

    // Phase 3: verify counts match
    targetClient = new MongoClient(TARGET_URI, { serverSelectionTimeoutMS: 10000 });
    await targetClient.connect();
    const targetDb = targetClient.db();

    for (const [name, expected] of Object.entries(expectedCounts)) {
      const actual = await targetDb.collection(name).countDocuments({});
      assert.equal(actual, expected, `${name} count mismatch: expected ${expected}, got ${actual}`);
    }

    // Phase 4: verify referential integrity — commits reference repos that exist
    const commitRepoIds = await targetDb.collection('commits').distinct('repoId');
    const repoIds = await targetDb.collection('repositories').distinct('_id');
    for (const repoId of commitRepoIds) {
      assert.ok(repoIds.includes(repoId), `commit references unknown repo ${repoId}`);
    }

    // Integration drill verified: counts match across all collections.
  });

  after(async () => {
    try {
      if (sourceClient) await sourceClient.close();
      if (targetClient) await targetClient.close();
    } catch {
      // Ignore
    }
    // Drop temp databases
    try {
      await dropDb(SOURCE_URI, 'frieday_backup_drill_source');
      await dropDb(TARGET_URI, 'frieday_backup_drill_target');
    } catch {
      // Ignore
    }
    // Cleanup backup dir
    try {
      fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });
});
