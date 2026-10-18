/**
 * Development seed script (tasks.md T3.1 expected output).
 *
 * SYNTHETIC DATA ONLY — every record below is hand-written fake content for
 * local development (dashboard reads before a real GitHub sync exists). It
 * is never real user data, never runs in production (refuses when
 * NODE_ENV=production), and is safe to wipe at any time.
 *
 * Usage: `node scripts/seed.dev.js` (from server/, with .env configured).
 * Covers one synthetic user across Repository, Commit, PullRequest, Issue,
 * LanguageSnapshot, ActivityBucket, Insight (+ existing SyncState/SyncJob).
 */
const mongoose = require('mongoose');

const logger = require('../src/utils/logger');
const { loadEnv } = require('../src/config/env');
const User = require('../src/models/User');
const Repository = require('../src/models/Repository');
const Commit = require('../src/models/Commit');
const PullRequest = require('../src/models/PullRequest');
const Issue = require('../src/models/Issue');
const LanguageSnapshot = require('../src/models/LanguageSnapshot');
const ActivityBucket = require('../src/models/ActivityBucket');
const Insight = require('../src/models/Insight');
const SyncState = require('../src/models/SyncState');

const SYNTHETIC_GITHUB_ID = 424242;

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed.dev.js refuses to run with NODE_ENV=production (synthetic data only).');
  }
  const env = loadEnv(process.env);
  await mongoose.connect(env.MONGO_URI);

  await User.deleteOne({ githubId: SYNTHETIC_GITHUB_ID }).exec();
  await User.create({
    githubId: SYNTHETIC_GITHUB_ID,
    login: 'synthetic-dev',
    avatarUrl: null,
    profileUrl: null,
    githubTokenEnc: null,
    scopes: [],
  });
  const user = await User.findOne({ githubId: SYNTHETIC_GITHUB_ID }).lean().exec();

  const repo = await Repository.create({
    userId: user._id,
    githubId: 42424201,
    owner: 'synthetic-dev',
    name: 'demo-api',
    fullName: 'synthetic-dev/demo-api',
    visibility: 'public',
    primaryLanguage: 'JavaScript',
    stars: 3,
    fork: false,
    defaultBranch: 'main',
    githubUpdatedAt: new Date(),
    pushedAt: new Date(),
    fetchedAt: new Date(),
    source: 'rest',
    lastSyncedAt: new Date(),
  });

  const authoredAt = new Date();
  await Commit.create({
    userId: user._id,
    sha: 'syntheticsha00000000000000000000000000000001',
    repoId: repo._id,
    messageHeadline: 'Synthetic commit (dev seed)',
    messageFull: 'Synthetic commit (dev seed)',
    authoredAt,
    fetchedAt: new Date(),
    source: 'rest',
  });

  await PullRequest.create({
    userId: user._id,
    repoId: repo._id,
    number: 1,
    state: 'closed',
    title: 'Synthetic PR (dev seed)',
    createdAt: authoredAt,
    mergedAt: authoredAt,
    merged: true,
    authorLogin: 'synthetic-dev',
    isAuthoredByUser: true,
    fetchedAt: new Date(),
    source: 'rest',
  });

  await Issue.create({
    userId: user._id,
    repoId: repo._id,
    number: 1,
    state: 'closed',
    title: 'Synthetic issue (dev seed)',
    createdAt: authoredAt,
    closedAt: authoredAt,
    authorLogin: 'synthetic-dev',
    isAuthoredByUser: true,
    fetchedAt: new Date(),
    source: 'rest',
  });

  await LanguageSnapshot.create({
    userId: user._id,
    repoId: repo._id,
    fetchedAt: new Date(),
    bytes: { JavaScript: 9000, CSS: 1000 },
    source: 'rest',
  });

  await ActivityBucket.create({
    userId: user._id,
    range: '30d',
    granularity: 'day',
    bucketStart: new Date(),
    commits: 1,
    prsOpened: 0,
    prsMerged: 1,
    issuesTouched: 1,
  });

  await Insight.create({
    userId: user._id,
    range: '30d',
    templateId: 'synthetic-seed',
    generatedAt: new Date(),
    title: 'Synthetic insight (dev seed)',
    text: 'This is synthetic seed data, not real developer activity.',
    metrics: {},
    evidence: { repoIds: [repo._id], commitShas: [], prNumbers: [1], bucketStarts: [] },
    confidence: 'Low',
  });

  await SyncState.updateOne(
    { userId: user._id, resource: 'repositories' },
    { $set: { status: 'done', lastSyncedAt: new Date() } },
    { upsert: true }
  ).exec();

  logger.info({ userId: String(user._id), msg: 'seeded synthetic dev data' });
  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error({ msg: 'seed failed', error: err && err.message ? err.message : String(err) });
  process.exitCode = 1;
});
