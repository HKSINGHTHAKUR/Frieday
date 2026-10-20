#!/usr/bin/env node
/**
 * Frieday — MongoDB logical backup/restore verification (Item 1, Phase 9).
 *
 * Read-only-by-default logical backup/restore drill using the Node.js
 * mongodb driver (no mongodump/mongorestore required). Designed to validate
 * that a restored database contains the expected collections, document counts,
 * and indexes without ever touching production.
 *
 * Modes:
 *   backup     Export collections from a source database to JSON files.
 *   restore    Import JSON files into a target (disposable) database.
 *   verify     Compare collection counts and indexes between two databases.
 *   drill      End-to-end: backup → restore → verify → cleanup (temp target).
 *
 * Safety guards (blocking):
 *   - Never prints or logs MongoDB URI, credentials, or passwords.
 *   - Refuses to connect to a production-looking URI (mongodb+srv://, Atlas
 *     hostnames, or any URI containing "frieday_prod"/"production").
 *   - Refuses to restore into a database whose name looks like production
 *     (frieday_prod, production, or the same name as the source).
 *   - Requires an explicit target database for restore/verify (no default).
 *   - Temp databases are only dropped after successful verification.
 *
 * Usage:
 *   node scripts/backup-restore.js backup <uri> <outDir> [dbName]
 *   node scripts/backup-restore.js restore <uri> <inDir> <targetDb>
 *   node scripts/backup-restore.js verify <srcUri> <tgtUri> [srcDb] [tgtDb]
 *   node scripts/backup-restore.js drill <srcUri> <tempDb> [outDir]
 *
 * Exit codes: 0 = success, 1 = validation/verification failure, 2 = misuse.
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_COLLECTIONS = [
  'users',
  'repositories',
  'commits',
  'pullrequests',
  'issues',
  'languagesnapshots',
  'activitybuckets',
  'insights',
  'syncstates',
  'syncjobs',
  'webhookdeliveries',
];

const PRODUCTION_DB_PATTERNS = [/frieday_prod/i, /production/i, /prod/i];

const ATLAS_URI_PATTERN = /^mongodb\+srv:\/\//i;

function isProductionDbName(name) {
  if (!name) return false;
  return PRODUCTION_DB_PATTERNS.some((p) => p.test(name));
}

function isAtlasUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  return ATLAS_URI_PATTERN.test(uri);
}

function validateUri(uri, label) {
  const problems = [];
  if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
    problems.push(`${label}: URI is empty`);
  } else {
    try {
      new URL(uri);
    } catch {
      problems.push(`${label}: not a parseable URI`);
    }
    if (isAtlasUri(uri)) {
      problems.push(
        `${label}: Atlas (mongodb+srv://) URIs are not supported by this script — use mongodump/mongorestore from the Atlas console instead`
      );
    }
    if (isProductionDbName(uri)) {
      problems.push(`${label}: URI targets a production-looking database name`);
    }
  }
  return problems;
}

function validateTargetDb(dbName, label, sourceDbName) {
  const problems = [];
  if (!dbName || typeof dbName !== 'string' || dbName.trim().length === 0) {
    problems.push(`${label}: target database name is empty`);
    return problems;
  }
  if (isProductionDbName(dbName)) {
    problems.push(
      `${label}: "${dbName}" looks like a production database — restore targets must be disposable/temp databases`
    );
  }
  if (sourceDbName && dbName === sourceDbName) {
    problems.push(
      `${label}: target database "${dbName}" is the same as the source — restore must target a separate database`
    );
  }
  return problems;
}

async function listCollections(db) {
  const collections = await db.listCollections().toArray();
  return collections.map((c) => c.name);
}

async function backupCollection(db, collectionName, outDir) {
  const coll = db.collection(collectionName);
  const docs = await coll.find({}).toArray();
  const outPath = path.join(outDir, `${collectionName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(docs, null, 2));
  return { collection: collectionName, count: docs.length };
}

async function restoreCollection(db, collectionName, inDir) {
  const inPath = path.join(inDir, `${collectionName}.json`);
  if (!fs.existsSync(inPath)) return { collection: collectionName, count: 0, skipped: true };
  const docs = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const coll = db.collection(collectionName);
  if (docs.length > 0) {
    await coll.insertMany(docs, { ordered: false });
  }
  return { collection: collectionName, count: docs.length };
}

async function getCollectionInfo(db, collectionName) {
  const coll = db.collection(collectionName);
  const count = await coll.countDocuments({});
  const indexes = await coll.indexes();
  return { count, indexes: indexes.map((i) => ({ name: i.name, keys: i.key })) };
}

async function runBackup(uri, outDir, dbName = null) {
  const problems = validateUri(uri, 'source');
  if (problems.length > 0) {
    console.error('BACKUP BLOCKED:');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(2);
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });

  try {
    await client.connect();
    const db = dbName ? client.db(dbName) : client.db();
    const actualDbName = db.databaseName;
    console.log(`Connected to source database: ${actualDbName}`);

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const collections = await listCollections(db);
    const targetCollections = DEFAULT_COLLECTIONS.filter((c) => collections.includes(c));
    const results = [];

    for (const name of targetCollections) {
      const result = await backupCollection(db, name, outDir);
      console.log(`  backed up ${result.collection}: ${result.count} documents`);
      results.push(result);
    }

    const total = results.reduce((sum, r) => sum + r.count, 0);
    console.log(`\nBackup complete: ${results.length} collections, ${total} documents → ${outDir}`);
    return 0;
  } finally {
    await client.close();
  }
}

async function runRestore(uri, inDir, targetDb) {
  const problems = validateUri(uri, 'target');
  if (problems.length > 0) {
    console.error('RESTORE BLOCKED:');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(2);
  }

  const targetProblems = validateTargetDb(targetDb, 'target database', null);
  if (targetProblems.length > 0) {
    console.error('RESTORE BLOCKED:');
    targetProblems.forEach((p) => console.error(`  - ${p}`));
    process.exit(2);
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });

  try {
    await client.connect();
    const db = client.db(targetDb);
    console.log(`Connected to target database: ${targetDb}`);

    const inFiles = fs.readdirSync(inDir).filter((f) => f.endsWith('.json'));
    const results = [];

    for (const file of inFiles) {
      const collectionName = file.replace(/\.json$/, '');
      const result = await restoreCollection(db, collectionName, inDir);
      if (result.skipped) {
        console.log(`  skipped ${result.collection}: no backup file`);
      } else {
        console.log(`  restored ${result.collection}: ${result.count} documents`);
      }
      results.push(result);
    }

    const total = results.reduce((sum, r) => sum + (r.count || 0), 0);
    console.log(`\nRestore complete: ${results.length} collections, ${total} documents ← ${inDir}`);
    return 0;
  } finally {
    await client.close();
  }
}

async function runVerify(srcUri, tgtUri, srcDb = null, tgtDb = null) {
  const srcProblems = validateUri(srcUri, 'source');
  const tgtProblems = validateUri(tgtUri, 'target');
  const allProblems = [...srcProblems, ...tgtProblems];
  if (allProblems.length > 0) {
    console.error('VERIFY BLOCKED:');
    allProblems.forEach((p) => console.error(`  - ${p}`));
    process.exit(2);
  }

  if (!tgtDb) {
    console.error('VERIFY BLOCKED: target database name is required');
    process.exit(2);
  }

  const tgtDbProblems = validateTargetDb(tgtDb, 'target database', srcDb);
  if (tgtDbProblems.length > 0) {
    console.error('VERIFY BLOCKED:');
    tgtDbProblems.forEach((p) => console.error(`  - ${p}`));
    process.exit(2);
  }

  const srcClient = new MongoClient(srcUri, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 30000 });
  const tgtClient = new MongoClient(tgtUri, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 30000 });

  try {
    await srcClient.connect();
    await tgtClient.connect();

    const srcDbObj = srcDb ? srcClient.db(srcDb) : srcClient.db();
    const tgtDbObj = tgtClient.db(tgtDb);
    const actualSrcDb = srcDbObj.databaseName;
    const actualTgtDb = tgtDbObj.databaseName;

    console.log(`Source: ${actualSrcDb}  →  Target: ${actualTgtDb}`);

    const srcCollections = await listCollections(srcDbObj);
    const targetCollections = DEFAULT_COLLECTIONS.filter((c) => srcCollections.includes(c));

    let allOk = true;
    for (const name of targetCollections) {
      const srcInfo = await getCollectionInfo(srcDbObj, name);
      let tgtInfo;
      try {
        tgtInfo = await getCollectionInfo(tgtDbObj, name);
      } catch {
        console.error(`  VERIFY FAIL: ${name} — missing in target`);
        allOk = false;
        continue;
      }

      const countMatch = srcInfo.count === tgtInfo.count;
      const indexNamesMatch =
        srcInfo.indexes
          .map((i) => i.name)
          .sort()
          .join(',') ===
        tgtInfo.indexes
          .map((i) => i.name)
          .sort()
          .join(',');

      if (countMatch && indexNamesMatch) {
        console.log(`  VERIFY OK: ${name} — ${srcInfo.count} documents, ${srcInfo.indexes.length} indexes`);
      } else {
        allOk = false;
        if (!countMatch) {
          console.error(
            `  VERIFY FAIL: ${name} — source ${srcInfo.count} docs vs target ${tgtInfo.count} docs`
          );
        }
        if (!indexNamesMatch) {
          console.error(`  VERIFY FAIL: ${name} — index mismatch`);
        }
      }
    }

    console.log(`\nVerification: ${allOk ? 'PASS' : 'FAIL'}`);
    return allOk ? 0 : 1;
  } finally {
    await srcClient.close();
    await tgtClient.close();
  }
}

async function runDrill(srcUri, tempDb, outDir = null) {
  const problems = validateUri(srcUri, 'source');
  if (problems.length > 0) {
    console.error('DRILL BLOCKED:');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(2);
  }

  const tempProblems = validateTargetDb(tempDb, 'temp database', null);
  if (tempProblems.length > 0) {
    console.error('DRILL BLOCKED:');
    tempProblems.forEach((p) => console.error(`  - ${p}`));
    process.exit(2);
  }

  const backupDir = outDir || path.join(require('node:os').tmpdir(), `frieday-backup-drill-${Date.now()}`);
  let exitCode = 0;

  try {
    console.log('=== PHASE 1: Backup ===');
    exitCode = await runBackup(srcUri, backupDir, null);
    if (exitCode !== 0) return exitCode;

    console.log('\n=== PHASE 2: Restore to temp database ===');
    const parsedUri = new URL(srcUri);
    parsedUri.pathname = `/${tempDb}`;
    const tempUri = parsedUri.toString();
    exitCode = await runRestore(tempUri, backupDir, tempDb);
    if (exitCode !== 0) return exitCode;

    console.log('\n=== PHASE 3: Verify ===');
    exitCode = await runVerify(srcUri, tempUri, null, tempDb);
    if (exitCode !== 0) return exitCode;

    console.log('\n=== PHASE 4: Cleanup temp database ===');
    const client = new MongoClient(tempUri, { serverSelectionTimeoutMS: 10000 });
    try {
      await client.connect();
      await client.db(tempDb).dropDatabase();
      console.log(`  Temp database "${tempDb}" dropped.`);
    } finally {
      await client.close();
    }

    console.log('\nDrill complete: backup → restore → verify → cleanup all PASS.');
    return 0;
  } finally {
    // Best-effort cleanup of backup files
    try {
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

const [mode, ...args] = process.argv.slice(2);

async function main() {
  let exitCode = 0;
  switch (mode) {
    case 'backup':
      exitCode = await runBackup(args[0], args[1], args[2] || null);
      break;
    case 'restore':
      if (!args[2]) {
        console.error('Usage: node scripts/backup-restore.js restore <uri> <inDir> <targetDb>');
        exitCode = 2;
        break;
      }
      exitCode = await runRestore(args[0], args[1], args[2]);
      break;
    case 'verify':
      if (!args[3]) {
        console.error('Usage: node scripts/backup-restore.js verify <srcUri> <tgtUri> [srcDb] <tgtDb>');
        exitCode = 2;
        break;
      }
      exitCode = await runVerify(args[0], args[1], args[2] || null, args[3]);
      break;
    case 'drill':
      if (!args[1]) {
        console.error('Usage: node scripts/backup-restore.js drill <srcUri> <tempDb> [outDir]');
        exitCode = 2;
        break;
      }
      exitCode = await runDrill(args[0], args[1], args[2] || null);
      break;
    default:
      console.error('Usage:');
      console.error('  node scripts/backup-restore.js backup <uri> <outDir> [dbName]');
      console.error('  node scripts/backup-restore.js restore <uri> <inDir> <targetDb>');
      console.error('  node scripts/backup-restore.js verify <srcUri> <tgtUri> [srcDb] <tgtDb>');
      console.error('  node scripts/backup-restore.js drill <srcUri> <tempDb> [outDir]');
      exitCode = 2;
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
