/**
 * Commits fetcher tests (T2.2).
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
process.env.SYNC_MAX_COMMITS_PER_REPO = '5';

const { encryptToken } = require('../src/services/auth/crypto.service');
const { createRateLimitGate } = require('../src/services/github/rateLimit');
const { createGithubClient } = require('../src/services/github/githubClient');
const {
  fetchCommits,
  fetchCommitsForRepositories,
  normalizeCommit,
} = require('../src/services/github/commits.fetcher');
const { createFakeGithub, pushResponse, resetFake } = require('./test-helpers/fakeGithub');

const FAKE_GITHUB_TOKEN = 'fake-gh-token-t22';
const userDoc = { githubTokenEnc: encryptToken(FAKE_GITHUB_TOKEN) };

function createCommitFixture(overrides = {}) {
  return {
    sha: 'abc123def456',
    commit: {
      message: 'Fix bug in authentication\n\nDetailed description of the fix',
      author: { name: 'Test User', email: 'test@example.com', date: '2024-01-15T10:00:00Z' },
      committer: { name: 'Test User', email: 'test@example.com', date: '2024-01-15T10:00:00Z' },
    },
    author: { login: 'testuser', id: 123, avatar_url: 'https://example.com/avatar.png' },
    committer: { login: 'testuser', id: 123, avatar_url: 'https://example.com/avatar.png' },
    stats: { additions: 10, deletions: 5, total: 15 },
    files: [{ filename: 'src/auth.js' }, { filename: 'test/auth.test.js' }],
    parents: [{ sha: 'parent1' }, { sha: 'parent2' }],
    ...overrides,
  };
}

describe('commits.fetcher (T2.2)', () => {
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

  describe('normalizeCommit', () => {
    it('normalizes a full commit object', () => {
      const commit = createCommitFixture();
      const dto = normalizeCommit(commit, 'repo-id-123', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.sha, 'abc123def456');
      assert.equal(dto.repoId, 'repo-id-123');
      assert.equal(dto.messageHeadline, 'Fix bug in authentication');
      assert.equal(dto.messageFull, 'Fix bug in authentication\n\nDetailed description of the fix');
      assert.ok(dto.authoredAt instanceof Date);
      assert.ok(dto.committedAt instanceof Date);
      assert.equal(dto.author.login, 'testuser');
      assert.equal(dto.additions, 10);
      assert.equal(dto.deletions, 5);
      assert.equal(dto.total, 15);
      assert.equal(dto.files.length, 2);
      assert.equal(dto.parents.length, 2);
    });

    it('truncates long commit message', () => {
      const commit = createCommitFixture({ commit: { message: 'a'.repeat(600) } });
      const dto = normalizeCommit(commit, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.messageFull.length, 500);
      assert.equal(dto.messageHeadline.length, 120);
    });

    it('handles missing author/committer', () => {
      const commit = createCommitFixture({ author: null, committer: null });
      const dto = normalizeCommit(commit, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.author, null);
      assert.equal(dto.committer, null);
    });

    it('handles missing stats', () => {
      const commit = createCommitFixture({ stats: null });
      const dto = normalizeCommit(commit, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.additions, 0);
      assert.equal(dto.deletions, 0);
      assert.equal(dto.total, 0);
    });

    it('limits files to 50', () => {
      const files = Array.from({ length: 60 }, (_, i) => ({ filename: `file${i}.js` }));
      const commit = createCommitFixture({ files });
      const dto = normalizeCommit(commit, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.files.length, 50);
    });
  });

  describe('fetchCommits', () => {
    it('fetches commits and returns normalized DTOs', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: [createCommitFixture({ sha: 'sha1' }), createCommitFixture({ sha: 'sha2' })],
      });
      const client = makeClient();
      const { commits, capReached } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client },
      });
      assert.equal(commits.length, 2);
      assert.equal(commits[0].sha, 'sha1');
      assert.equal(capReached, false);
    });

    it('returns empty array for no commits', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      const { commits } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } });
      assert.equal(commits.length, 0);
    });

    it('treats a malformed (non-array) body as an empty result, not a crash', async () => {
      pushResponse(fakeGithub, { status: 200, body: { unexpected: 'object' } });
      const client = makeClient();
      const { commits, capReached } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client },
      });
      assert.deepEqual(commits, []);
      assert.equal(capReached, false);
    });

    it('surfaces a mid-pagination failure instead of returning partial data as success', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 100 }, (_, i) => createCommitFixture({ sha: `sha${i}` })),
      });
      pushResponse(fakeGithub, { status: 500 });
      const client = makeClient();
      await assert.rejects(
        fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { maxCommits: 500, deps: { client } }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });

    it('treats network failure as retryable', async () => {
      const client = createGithubClient(userDoc, {
        gate: createRateLimitGate(),
        githubConfig: { apiBase: 'http://127.0.0.1:9999' },
      });
      await assert.rejects(
        fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.retryable === true
      );
    });

    it('respects maxCommits cap', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 10 }, (_, i) => createCommitFixture({ sha: `sha${i}` })),
      });
      const client = makeClient();
      const { commits, capReached } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        maxCommits: 3,
        deps: { client },
      });
      assert.equal(commits.length, 3);
      assert.equal(capReached, true);
    });

    it('handles pagination', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 100 }, (_, i) => createCommitFixture({ sha: `sha${i}` })),
      });
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 50 }, (_, i) => createCommitFixture({ sha: `sha${i + 100}` })),
      });
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      const { commits, capReached } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        maxCommits: 200,
        deps: { client },
      });
      assert.equal(commits.length, 150);
      assert.equal(capReached, false);
    });

    it('follows the Link header next page to completion', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/commits?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createCommitFixture({ sha: 'sha1' })],
        headers: { Link: linkNext },
      });
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture({ sha: 'sha2' })] }); // no Link → stop
      const client = makeClient();
      const { commits, capReached } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        maxCommits: 200,
        deps: { client },
      });
      assert.equal(commits.length, 2);
      assert.equal(commits[0].sha, 'sha1');
      assert.equal(commits[1].sha, 'sha2');
      assert.equal(capReached, false);
      assert.equal(fakeGithub.calls.length, 2, 'exactly two pages must be fetched');
      assert.ok(fakeGithub.calls[1].url.includes('page=2'), 'the second request must follow the linked page');
    });

    it('follows Link next even when the page is short', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/commits?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createCommitFixture({ sha: 'sha1' })],
        headers: { Link: linkNext },
      });
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture({ sha: 'sha2' })] });
      const client = makeClient();
      const { commits } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        maxCommits: 200,
        deps: { client },
      });
      assert.equal(commits.length, 2, 'the server-authoritative Link wins over short-page termination');
      assert.equal(fakeGithub.calls.length, 2);
    });

    it('ignores a non-advancing Link next instead of looping', async () => {
      const linkSelf = `<${fakeUrl}/repos/owner/repo/commits?per_page=100&page=1>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createCommitFixture({ sha: 'sha1' })],
        headers: { Link: linkSelf },
      });
      const client = makeClient();
      const { commits, capReached } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        maxCommits: 200,
        deps: { client },
      });
      assert.equal(commits.length, 1);
      assert.equal(capReached, false);
      assert.equal(fakeGithub.calls.length, 1, 'a self-referential Link must not cause another fetch');
    });

    it('stops at the cap even when a Link next page exists', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/commits?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 10 }, (_, i) => createCommitFixture({ sha: `sha${i}` })),
        headers: { Link: linkNext },
      });
      const client = makeClient();
      const { commits, capReached } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        maxCommits: 3,
        deps: { client },
      });
      assert.equal(commits.length, 3);
      assert.equal(capReached, true);
      assert.equal(fakeGithub.calls.length, 1, 'no further page may be fetched once capped');
    });

    it('uses since cursor for incremental sync', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture()] });
      const client = makeClient();
      await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { since: '2024-01-01T00:00:00Z' },
        deps: { client },
      });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.ok(call.url.includes('since=2024-01-01T00%3A00%3A00Z'));
    });

    it('uses sha cursor for branch-specific fetch', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture()] });
      const client = makeClient();
      await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { sha: 'develop' },
        deps: { client },
      });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.ok(call.url.includes('sha=develop'));
    });

    it('propagates 401 as UNAUTHENTICATED without leaking the token', async () => {
      pushResponse(fakeGithub, { status: 401 });
      const client = makeClient();
      await assert.rejects(fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }), (err) => {
        assert.ok(
          !JSON.stringify({ message: err.message, details: err.details }).includes(FAKE_GITHUB_TOKEN),
          'thrown errors must never carry the token'
        );
        return err.code === 'UNAUTHENTICATED';
      });
    });

    it('propagates a bare 403 as UNAUTHENTICATED (T2.1 contract)', async () => {
      pushResponse(fakeGithub, { status: 403 });
      const client = makeClient();
      await assert.rejects(
        fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'UNAUTHENTICATED' && err.retryable === false
      );
    });

    it('propagates 404 as NOT_FOUND', async () => {
      pushResponse(fakeGithub, { status: 404 });
      const client = makeClient();
      await assert.rejects(
        fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'NOT_FOUND'
      );
    });

    it('propagates 500 as GITHUB_UNREACHABLE retryable', async () => {
      pushResponse(fakeGithub, { status: 500 });
      const client = makeClient();
      await assert.rejects(
        fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });

    it('propagates 422 as non-retryable without crashing', async () => {
      pushResponse(fakeGithub, { status: 422, body: { message: 'Validation Failed' } });
      const client = makeClient();
      await assert.rejects(
        fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.retryable === false
      );
    });

    it('treats 409 as an empty repository (empty result, not a failure)', async () => {
      pushResponse(fakeGithub, { status: 409, body: { message: 'Git Repository is empty.' } });
      const client = makeClient();
      const { commits, capReached, notModified } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client },
      });
      assert.deepEqual(commits, []);
      assert.equal(capReached, false);
      assert.equal(notModified, false);
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
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture({ sha: 'resumed' })] });
      const { commits, notModified } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client: gatedClient },
      });
      assert.equal(commits.length, 1);
      assert.equal(commits[0].sha, 'resumed');
      assert.equal(notModified, false);
      assert.deepEqual(sleeps, [60000], 'the gate must sleep exactly the retry window before retrying');
    });

    it('returns notModified on 304 without treating it as a failure', async () => {
      pushResponse(fakeGithub, { status: 304, body: '' });
      const client = makeClient();
      const { commits, notModified, capReached } = await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { etag: '"abc123"', page: 2 },
        deps: { client },
      });
      assert.deepEqual(commits, []);
      assert.equal(notModified, true);
      assert.equal(capReached, false);
    });

    it('sends If-None-Match when the cursor carries an etag', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { etag: '"abc123"' },
        deps: { client },
      });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], '"abc123"');
    });

    it('sends no conditional header when the cursor has no etag', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      await fetchCommits(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], undefined);
    });
  });

  describe('fetchCommitsForRepositories', () => {
    it('fetches commits for multiple repositories', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture({ sha: 'sha1' })] });
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture({ sha: 'sha2' })] });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { commits, cursors, capReached } = await fetchCommitsForRepositories(userDoc, repos, {
        deps: { client },
      });
      assert.equal(commits.length, 2);
      assert.ok(cursors.has('owner1/repo1'));
      assert.ok(cursors.has('owner2/repo2'));
      assert.equal(capReached, false);
    });

    it('reports per-repository progress with cursors in call order', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture({ sha: 'sha1' })] });
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture({ sha: 'sha2' })] });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const seen = [];
      const { commits } = await fetchCommitsForRepositories(userDoc, repos, {
        deps: { client },
        onProgress: async (info) => {
          seen.push(info);
        },
      });
      assert.equal(commits.length, 2);
      assert.equal(seen.length, 2);
      assert.equal(seen[0].key, 'owner1/repo1');
      assert.equal(seen[0].index, 0);
      assert.equal(seen[0].total, 2);
      assert.ok(seen[0].cursor, 'progress must carry the repo cursor for checkpoints');
      assert.equal(seen[1].key, 'owner2/repo2');
      assert.equal(seen[1].index, 1);
    });

    it('continues on per-repo error and records it without failing good repos', async () => {
      pushResponse(fakeGithub, { status: 404 }); // First repo fails
      pushResponse(fakeGithub, { status: 200, body: [createCommitFixture({ sha: 'sha2' })] }); // Second succeeds
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { commits, cursors, errors, capReached } = await fetchCommitsForRepositories(userDoc, repos, {
        deps: { client },
      });
      assert.equal(commits.length, 1);
      assert.equal(commits[0].sha, 'sha2');
      assert.ok(cursors.has('owner2/repo2'));
      assert.ok(!cursors.has('owner1/repo1'), 'a failed repo must not get a success cursor');
      assert.ok(errors.has('owner1/repo1'), 'the failure must be recorded, not swallowed');
      assert.equal(errors.get('owner1/repo1').code, 'NOT_FOUND');
      assert.equal(capReached, false);
    });
  });
});
