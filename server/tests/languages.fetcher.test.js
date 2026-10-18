/**
 * Languages fetcher tests (T2.2).
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { encryptToken } = require('../src/services/auth/crypto.service');
const { createRateLimitGate } = require('../src/services/github/rateLimit');
const { createGithubClient } = require('../src/services/github/githubClient');
const {
  fetchLanguages,
  fetchLanguagesForRepositories,
  normalizeLanguages,
} = require('../src/services/github/languages.fetcher');
const { createFakeGithub, pushResponse, resetFake } = require('./test-helpers/fakeGithub');

const FAKE_GITHUB_TOKEN = 'fake-gh-token-t22';
const userDoc = { githubTokenEnc: encryptToken(FAKE_GITHUB_TOKEN) };

describe('languages.fetcher (T2.2)', () => {
  let fakeGithub, fakeUrl, fakeClose;

  before(async () => {
    const created = createFakeGithub();
    fakeGithub = created.fake;
    fakeClose = created.close;
    await created.ready;
    fakeUrl = fakeGithub.url;
  });

  after(async () => {
    await fakeClose();
  });

  function makeClient() {
    return createGithubClient(userDoc, { gate: createRateLimitGate(), githubConfig: { apiBase: fakeUrl } });
  }

  beforeEach(() => resetFake(fakeGithub));

  describe('normalizeLanguages', () => {
    it('normalizes languages object to array', () => {
      const languages = { JavaScript: 50000, TypeScript: 30000, HTML: 5000 };
      const dto = normalizeLanguages(languages, 'repo-id-123', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.repoId, 'repo-id-123');
      assert.equal(dto.languages.length, 3);
      assert.equal(dto.totalBytes, 85000);
      assert.deepEqual(dto.languages[0], { language: 'JavaScript', bytes: 50000 });
      assert.deepEqual(dto.languages[1], { language: 'TypeScript', bytes: 30000 });
      assert.deepEqual(dto.languages[2], { language: 'HTML', bytes: 5000 });
    });

    it('handles empty languages object', () => {
      const dto = normalizeLanguages({}, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.languages.length, 0);
      assert.equal(dto.totalBytes, 0);
    });

    it('handles null/undefined', () => {
      const dto = normalizeLanguages(null, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.languages.length, 0);
      assert.equal(dto.totalBytes, 0);
    });

    it('handles non-numeric bytes', () => {
      const languages = { JavaScript: '50000', TypeScript: null };
      const dto = normalizeLanguages(languages, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.languages[0].bytes, 0);
      assert.equal(dto.languages[1].bytes, 0);
    });
  });

  describe('fetchLanguages', () => {
    it('fetches languages and returns normalized DTO', async () => {
      pushResponse(fakeGithub, { status: 200, body: { JavaScript: 50000, TypeScript: 30000 } });
      const client = makeClient();
      const snapshot = await fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client });
      assert.equal(snapshot.repoId, 'repo-id');
      assert.equal(snapshot.languages.length, 2);
      assert.equal(snapshot.totalBytes, 80000);
    });

    it('returns null for 404', async () => {
      pushResponse(fakeGithub, { status: 404 });
      const client = makeClient();
      const snapshot = await fetchLanguages(userDoc, 'owner', 'nonexistent', 'repo-id', { client });
      assert.equal(snapshot, null);
    });

    it('handles empty response', async () => {
      pushResponse(fakeGithub, { status: 200, body: {} });
      const client = makeClient();
      const snapshot = await fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client });
      assert.equal(snapshot.languages.length, 0);
      assert.equal(snapshot.totalBytes, 0);
    });

    it('propagates 401 as UNAUTHENTICATED without leaking the token', async () => {
      pushResponse(fakeGithub, { status: 401 });
      const client = makeClient();
      await assert.rejects(fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client }), (err) => {
        assert.ok(
          !JSON.stringify({ message: err.message, details: err.details }).includes(FAKE_GITHUB_TOKEN),
          'thrown errors must never carry the token'
        );
        return err.code === 'UNAUTHENTICATED';
      });
    });

    it('propagates 500 as GITHUB_UNREACHABLE retryable', async () => {
      pushResponse(fakeGithub, { status: 500 });
      const client = makeClient();
      await assert.rejects(
        fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });

    it('treats network failure as retryable', async () => {
      const client = createGithubClient(userDoc, {
        gate: createRateLimitGate(),
        githubConfig: { apiBase: 'http://127.0.0.1:9999' },
      });
      await assert.rejects(
        fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client }),
        (err) => err.retryable === true
      );
    });

    it('propagates a bare 403 as UNAUTHENTICATED (T2.1 contract)', async () => {
      pushResponse(fakeGithub, { status: 403 });
      const client = makeClient();
      await assert.rejects(
        fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client }),
        (err) => err.code === 'UNAUTHENTICATED' && err.retryable === false
      );
    });

    it('propagates 422 as non-retryable without crashing', async () => {
      pushResponse(fakeGithub, { status: 422, body: { message: 'Validation Failed' } });
      const client = makeClient();
      await assert.rejects(
        fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client }),
        (err) => err.retryable === false
      );
    });

    it('returns null on 304 without treating it as a failure', async () => {
      pushResponse(fakeGithub, { status: 304, body: '' });
      const client = makeClient();
      const snapshot = await fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', {
        etag: '"abc123"',
        client,
      });
      assert.equal(snapshot, null);
    });

    it('sends If-None-Match when an etag is provided', async () => {
      pushResponse(fakeGithub, { status: 200, body: { JavaScript: 100 } });
      const client = makeClient();
      await fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { etag: '"abc123"', client });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], '"abc123"');
    });

    it('sends no conditional header when no etag is provided', async () => {
      pushResponse(fakeGithub, { status: 200, body: { JavaScript: 100 } });
      const client = makeClient();
      await fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], undefined);
    });

    it('forwards per-repo etags from cursors in the multi-repo fetch', async () => {
      pushResponse(fakeGithub, { status: 200, body: { JavaScript: 100 } });
      pushResponse(fakeGithub, { status: 200, body: { Python: 200 } });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const cursors = new Map([['owner1/repo1', { etag: '"etag-1"' }]]);
      const { languageSnapshots } = await fetchLanguagesForRepositories(userDoc, repos, { cursors, client });
      assert.equal(languageSnapshots.length, 2);
      assert.equal(fakeGithub.calls[0].headers['if-none-match'], '"etag-1"');
      assert.equal(fakeGithub.calls[1].headers['if-none-match'], undefined);
    });

    it('pauses on 429 through the gate and resumes successfully', async () => {
      const sleeps = [];
      let now = 0;
      const gate = createRateLimitGate({
        now: () => now,
        sleep: async (ms) => {
          now += ms;
          sleeps.push(ms);
        },
      });
      const gatedClient = createGithubClient(userDoc, { gate, githubConfig: { apiBase: fakeUrl } });
      pushResponse(fakeGithub, { status: 429, headers: { 'retry-after': '60' } });
      pushResponse(fakeGithub, { status: 200, body: { JavaScript: 1000 } });
      const snapshot = await fetchLanguages(userDoc, 'owner', 'repo', 'repo-id', { client: gatedClient });
      assert.ok(snapshot);
      assert.equal(snapshot.totalBytes, 1000);
      assert.deepEqual(sleeps, [60000], 'the gate must sleep exactly the retry window before retrying');
    });
  });

  describe('fetchLanguagesForRepositories', () => {
    it('fetches languages for multiple repositories', async () => {
      pushResponse(fakeGithub, { status: 200, body: { JavaScript: 50000 } });
      pushResponse(fakeGithub, { status: 200, body: { Python: 20000 } });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { languageSnapshots, errors } = await fetchLanguagesForRepositories(userDoc, repos, { client });
      assert.equal(languageSnapshots.length, 2);
      assert.equal(languageSnapshots[0].repoId, 'repo-id-1');
      assert.equal(languageSnapshots[1].repoId, 'repo-id-2');
      assert.equal(errors.size, 0);
    });

    it('reports per-repository progress in call order', async () => {
      pushResponse(fakeGithub, { status: 200, body: { JavaScript: 100 } });
      pushResponse(fakeGithub, { status: 200, body: { Python: 200 } });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const seen = [];
      await fetchLanguagesForRepositories(userDoc, repos, {
        client,
        onProgress: async (info) => {
          seen.push(info);
        },
      });
      assert.equal(seen.length, 2);
      assert.equal(seen[0].key, 'owner1/repo1');
      assert.equal(seen[0].index, 0);
      assert.equal(seen[0].total, 2);
      assert.equal(seen[1].key, 'owner2/repo2');
      assert.equal(seen[1].index, 1);
    });

    it('continues on per-repo error', async () => {
      pushResponse(fakeGithub, { status: 404 }); // First repo fails
      pushResponse(fakeGithub, { status: 200, body: { Python: 20000 } }); // Second succeeds
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { languageSnapshots, errors } = await fetchLanguagesForRepositories(userDoc, repos, { client });
      assert.equal(languageSnapshots.length, 1);
      assert.equal(languageSnapshots[0].repoId, 'repo-id-2');
      assert.ok(errors.has('owner1/repo1'), 'the skipped repo must be recorded, not silent');
      assert.equal(errors.get('owner1/repo1').code, 'NOT_FOUND');
    });

    it('handles all repos failing', async () => {
      pushResponse(fakeGithub, { status: 404 });
      pushResponse(fakeGithub, { status: 404 });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { languageSnapshots, errors } = await fetchLanguagesForRepositories(userDoc, repos, { client });
      assert.equal(languageSnapshots.length, 0);
      assert.equal(errors.size, 2);
    });
  });
});
