// Frieday — Read-only Phase 8 criteria 4 & 5 verification script
// Compares insight evidence and timeline bucket counts with MongoDB records.
//
// Usage:
//   node scripts/verify-phase8-criteria4-5.js
//     (loads .env via dotenv; MONGO_URI must be set there or in the environment)
//   FRIEDAY_VERIFY_DB=frieday_prod node scripts/verify-phase8-criteria4-5.js  # override database
//
// Safety: read-only. Only performs find() / countDocuments() queries.
// Never prints MONGO_URI or credentials. Exits non-zero on mismatch.

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('BLOCKED: MONGO_URI is not configured. Set it in .env or export MONGO_URI and re-run.');
  process.exit(2);
}

const verifyDb = process.env.FRIEDAY_VERIFY_DB || null; // override database name; default = URI database
const rawUserId = process.env.FRIEDAY_VERIFY_USER_ID; // optional owner userId scope (ObjectId string)
let userIdFilter = {};
if (rawUserId) {
  try {
    userIdFilter = { userId: new ObjectId(rawUserId) };
  } catch {
    console.error('BLOCKED: FRIEDAY_VERIFY_USER_ID is not a valid MongoDB ObjectId.');
    process.exit(2);
  }
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});

async function main() {
  await client.connect();
  try {
    const db = verifyDb ? client.db(verifyDb) : client.db();

    // Upper bound matching loadRawData() in composer-data.js:
    // loadRawData filters commits with authoredAt: { $lte: end } where
    // end = dayStartUTC(anchor) (today at 00:00 UTC). Commits during the
    // current day (after midnight UTC) are excluded from computeTimeline.
    const todayStartUTC = new Date();
    todayStartUTC.setUTCHours(0, 0, 0, 0);

    // Verify expected collections exist; fail clearly if database is wrong
    const expectedCollections = [
      'insights',
      'activitybuckets',
      'repositories',
      'commits',
      'pullrequests',
      'issues',
    ];
    const existing = await db.listCollections().toArray();
    const existingNames = existing.map((c) => c.name);
    const missing = expectedCollections.filter((name) => !existingNames.includes(name));
    if (missing.length > 0) {
      console.error(
        `BLOCKED: database does not contain expected collections: ${missing.join(', ')}. ` +
          'Set FRIEDAY_VERIFY_DB to the correct database name (e.g. frieday_prod) and re-run.'
      );
      process.exit(2);
    }

    // ── Criterion 4: insight evidence matches DB records ──
    const insights = await db.collection('insights').find(userIdFilter).toArray();
    let criterion4Pass = true;

    for (const insight of insights) {
      const evidence = insight.evidence || {};

      // repoIds → Repository._id (ObjectId)
      for (const repoId of evidence.repoIds || []) {
        const count = await db.collection('repositories').countDocuments({ _id: repoId });
        if (count === 0) {
          console.error(
            `CRITERION 4 FAIL: insight ${insight.templateId} references repo not found in repositories`
          );
          criterion4Pass = false;
        }
      }

      // commitShas → Commit.sha (String)
      for (const sha of evidence.commitShas || []) {
        const count = await db.collection('commits').countDocuments({ sha });
        if (count === 0) {
          console.error(
            `CRITERION 4 FAIL: insight ${insight.templateId} references commit not found in commits`
          );
          criterion4Pass = false;
        }
      }

      // prNumbers → PullRequest.number (existence only; PR numbers are per-repo)
      for (const prNumber of evidence.prNumbers || []) {
        const count = await db.collection('pullrequests').countDocuments({ number: prNumber });
        if (count === 0) {
          console.error(
            `CRITERION 4 FAIL: insight ${insight.templateId} references PR not found in pullrequests`
          );
          criterion4Pass = false;
        }
      }

      // bucketStarts → ActivityBucket.bucketStart (Date)
      for (const bucketStart of evidence.bucketStarts || []) {
        const count = await db.collection('activitybuckets').countDocuments({ bucketStart });
        if (count === 0) {
          console.error(
            `CRITERION 4 FAIL: insight ${insight.templateId} references bucket not found in activitybuckets`
          );
          criterion4Pass = false;
        }
      }

      // Cross-check: if insight reports commits, buckets should exist for that range
      const range = insight.range;
      const metrics = insight.metrics || {};
      const bucketCount = await db.collection('activitybuckets').countDocuments({ range });
      if (
        bucketCount === 0 &&
        metrics &&
        typeof metrics.totalCommits === 'number' &&
        metrics.totalCommits > 0
      ) {
        console.error(
          `CRITERION 4 FAIL: insight ${insight.templateId} reports commits but no buckets for range ${range}`
        );
        criterion4Pass = false;
      }
    }
    console.log(`Criterion 4: ${insights.length} insights checked — ${criterion4Pass ? 'PASS' : 'FAIL'}`);

    // ── Criterion 5: timeline buckets match direct DB counts ──
    const buckets = await db.collection('activitybuckets').find(userIdFilter).toArray();
    let criterion5Pass = true;

    for (const bucket of buckets) {
      // Compute bucketEnd from granularity (day = 1 day, week = 7 days). No bucketEnd field exists.
      const bucketStart = new Date(bucket.bucketStart);
      const bucketEnd = new Date(bucketStart.getTime());
      if (bucket.granularity === 'day') {
        bucketEnd.setUTCDate(bucketEnd.getUTCDate() + 1);
      } else {
        bucketEnd.setUTCDate(bucketEnd.getUTCDate() + 7);
      }

      // Count commits matching the bucket's scope: userId + authoredAt range + repoId (per-repo buckets only).
      // Aggregate buckets (repoId: null) count all user commits; per-repo buckets count only that repo's commits.
      // This mirrors computeTimeline()'s matchesRepo() filter and the timeline route's repoId scoping.
      const commitQuery = {
        userId: bucket.userId,
        authoredAt: {
          $gte: bucketStart,
          $lt: bucketEnd,
          $lte: todayStartUTC, // match loadRawData() upper bound (excludes today's commits)
        },
      };
      if (bucket.repoId) {
        commitQuery.repoId = bucket.repoId;
      }

      const expectedCommits = await db.collection('commits').countDocuments(commitQuery);

      if (bucket.commits !== expectedCommits) {
        console.error(
          `CRITERION 5 FAIL: bucket ${bucket.bucketStart} reports ${bucket.commits} commits, DB has ${expectedCommits}`
        );
        criterion5Pass = false;
      }
    }
    console.log(`Criterion 5: ${buckets.length} buckets checked — ${criterion5Pass ? 'PASS' : 'FAIL'}`);

    if (!criterion4Pass || !criterion5Pass) process.exit(1);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  // Never print the URI or credentials — redact any embedded credentials in error messages
  const msg = String(err.message || err);
  const safeMsg = msg.replace(/mongodb\+srv:\/\/[^@]+@/g, 'mongodb+srv://<redacted>@');
  console.error('Verification error:', safeMsg);
  process.exit(1);
});
