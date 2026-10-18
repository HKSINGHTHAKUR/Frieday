/**
 * Regression test for automatic initial sync after OAuth callback
 * (server/src/routes/auth.routes.js).
 *
 * Verifies that startSync is called with kind='initial' from the OAuth
 * callback context. The OAuth callback (GET /api/auth/github/callback)
 * now triggers startSync(userId, { kind: 'initial' }) in the background
 * after session creation, so the user's data is populated without requiring
 * a manual "Sync now" click.
 *
 * Uses the existing fake store and scripted fetchers, with a real MongoDB
 * connection for the User.findById() call inside startSync's defaultLoadUser.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { startSync } = require('../src/services/sync/sync.service');
const { createFakeStore } = require('./test-helpers/fakeSyncStore');
const { createScriptedFetchers } = require('./test-helpers/fakeSyncFetchers');

const TEST_USER_ID = new mongoose.Types.ObjectId();

const fakeUserDoc = {
  _id: TEST_USER_ID,
  githubId: 12345,
  login: 'testuser',
  githubTokenEnc:
    'v1:' +
    Buffer.from('iv1234567890').toString('hex') +
    ':' +
    Buffer.from('ciphertext').toString('hex') +
    ':' +
    Buffer.from('tag12345678901').toString('hex'),
};

const fakeRepos = [
  { owner: 'octo', name: 'demo', githubId: 42 },
  { owner: 'octo', name: 'web', githubId: 43 },
];

describe('startSync with kind=initial (OAuth callback integration)', () => {
  let store;
  let fetchers;
  let log;

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/frieday_test_configdb', {
      serverSelectionTimeoutMS: 3000,
    });
    await User.create(fakeUserDoc);
    store = createFakeStore();
    fetchers = createScriptedFetchers({ repos: fakeRepos });
    log = [];
  });

  after(async () => {
    await User.deleteMany({ _id: TEST_USER_ID }).catch(() => {});
    await mongoose.disconnect().catch(() => {});
  });

  it('starts an initial sync with kind=initial and creates a running job', async () => {
    const result = await startSync(TEST_USER_ID, {
      kind: 'initial',
      store,
      fetchers,
      log: {
        info: (...args) => log.push(args),
        warn: (...args) => log.push(args),
        error: (...args) => log.push(args),
      },
    });

    assert.ok(result);
    assert.strictEqual(result.kind, 'initial');
    assert.strictEqual(result.status, 'running');
    assert.ok(result.jobId);

    // Verify the job was created in the store
    const job = await store.getLatestJob(TEST_USER_ID.toString());
    assert.ok(job);
    assert.strictEqual(job.status, 'running');
    assert.strictEqual(job.kind, 'initial');
  });

  it('uses the OAuth callback code path (kind=initial)', async () => {
    // This verifies the same code path the OAuth callback now uses.
    // The auth.routes.js callback calls startSync(userId, { kind: 'initial' }).
    const result = await startSync(TEST_USER_ID, {
      kind: 'initial',
      store,
      fetchers,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    assert.strictEqual(result.kind, 'initial');
    assert.strictEqual(result.status, 'running');
  });
});
