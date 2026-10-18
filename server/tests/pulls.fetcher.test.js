/**
 * Pull requests fetcher tests (T2.2).
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
process.env.SYNC_MAX_PRS_PER_REPO = '5';

const { encryptToken } = require('../src/services/auth/crypto.service');
const { createRateLimitGate } = require('../src/services/github/rateLimit');
const { createGithubClient } = require('../src/services/github/githubClient');
const {
  fetchPullRequests,
  fetchPullRequestsForRepositories,
  fetchPullRequest,
  normalizePullRequest,
} = require('../src/services/github/pulls.fetcher');
const { createFakeGithub, pushResponse, resetFake } = require('./test-helpers/fakeGithub');

const FAKE_GITHUB_TOKEN = 'fake-gh-token-t22';
const userDoc = { githubTokenEnc: encryptToken(FAKE_GITHUB_TOKEN) };

function createPrFixture(overrides = {}) {
  return {
    number: 42,
    state: 'open',
    title: 'Add new feature',
    body: 'This PR adds a new feature\n\nDetailed description',
    created_at: '2024-01-10T10:00:00Z',
    updated_at: '2024-01-12T10:00:00Z',
    closed_at: null,
    merged_at: null,
    user: { login: 'author', id: 1, avatar_url: 'https://example.com/avatar.png' },
    author_association: 'OWNER',
    draft: false,
    additions: 100,
    deletions: 20,
    changed_files: 5,
    commits: 3,
    comments: 10,
    review_comments: 5,
    base: { ref: 'main', sha: 'base-sha', repo: { id: 123, full_name: 'owner/repo' } },
    head: { ref: 'feature', sha: 'head-sha', repo: { id: 123, full_name: 'owner/repo' } },
    mergeable: true,
    mergeable_state: 'clean',
    merged: false,
    merged_by: null,
    requested_reviewers: [{ login: 'reviewer1', id: 2, avatar_url: 'https://example.com/avatar2.png' }],
    reviewers: [{ login: 'reviewer2', id: 3, avatar_url: 'https://example.com/avatar3.png' }],
    labels: [{ name: 'enhancement', color: 'a2eeef', description: 'New feature' }],
    ...overrides,
  };
}

describe('pulls.fetcher (T2.2)', () => {
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

  describe('normalizePullRequest', () => {
    it('normalizes a full PR object', () => {
      const pr = createPrFixture();
      const dto = normalizePullRequest(pr, 'repo-id-123', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.number, 42);
      assert.equal(dto.repoId, 'repo-id-123');
      assert.equal(dto.state, 'open');
      assert.equal(dto.title, 'Add new feature');
      assert.equal(dto.body, 'This PR adds a new feature\n\nDetailed description');
      assert.ok(dto.createdAt instanceof Date);
      assert.ok(dto.updatedAt instanceof Date);
      assert.equal(dto.closedAt, null);
      assert.equal(dto.mergedAt, null);
      assert.equal(dto.author.login, 'author');
      assert.equal(dto.additions, 100);
      assert.equal(dto.deletions, 20);
      assert.equal(dto.changedFiles, 5);
      assert.equal(dto.commits, 3);
      assert.equal(dto.requestedReviewers.length, 1);
      assert.equal(dto.reviewers.length, 1);
      assert.equal(dto.labels.length, 1);
      assert.equal(dto.labels[0], 'enhancement');
    });

    it('handles merged PR', () => {
      const pr = createPrFixture({
        state: 'closed',
        merged_at: '2024-01-15T10:00:00Z',
        merged: true,
        merged_by: { login: 'merger', id: 4, avatar_url: 'https://example.com/avatar4.png' },
      });
      const dto = normalizePullRequest(pr, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.ok(dto.mergedAt instanceof Date);
      assert.equal(dto.merged, true);
      assert.equal(dto.mergedBy.login, 'merger');
    });

    it('truncates long title and body', () => {
      const pr = createPrFixture({ title: 'a'.repeat(300), body: 'b'.repeat(600) });
      const dto = normalizePullRequest(pr, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.title.length, 200);
      assert.equal(dto.body.length, 500);
    });

    it('handles missing optional fields', () => {
      const pr = createPrFixture({
        body: null,
        merged_by: null,
        base: { ref: 'main', repo: null },
        head: { ref: 'feature', repo: null },
        requested_reviewers: null,
        reviewers: null,
        labels: null,
      });
      const dto = normalizePullRequest(pr, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.body, null);
      assert.equal(dto.mergedBy, null);
      assert.equal(dto.baseRepo, null);
      assert.equal(dto.headRepo, null);
      assert.deepEqual(dto.requestedReviewers, []);
      assert.deepEqual(dto.reviewers, []);
      assert.deepEqual(dto.labels, []);
    });
  });

  describe('fetchPullRequests', () => {
    it('fetches PRs and returns normalized DTOs', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: [createPrFixture({ number: 1 }), createPrFixture({ number: 2 })],
      });
      const client = makeClient();
      const { prs, capReached } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client },
      });
      assert.equal(prs.length, 2);
      assert.equal(prs[0].number, 1);
      assert.equal(capReached, false);
    });

    it('returns empty array for no PRs', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      const { prs } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } });
      assert.equal(prs.length, 0);
    });

    it('treats a malformed (non-array) body as an empty result, not a crash', async () => {
      pushResponse(fakeGithub, { status: 200, body: { unexpected: 'object' } });
      const client = makeClient();
      const { prs, capReached } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client },
      });
      assert.deepEqual(prs, []);
      assert.equal(capReached, false);
    });

    it('treats network failure as retryable', async () => {
      const client = createGithubClient(userDoc, {
        gate: createRateLimitGate(),
        githubConfig: { apiBase: 'http://127.0.0.1:9999' },
      });
      await assert.rejects(
        fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.retryable === true
      );
    });

    it('respects maxPrs cap', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 10 }, (_, i) => createPrFixture({ number: i })),
      });
      const client = makeClient();
      const { prs, capReached } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        maxPrs: 3,
        deps: { client },
      });
      assert.equal(prs.length, 3);
      assert.equal(capReached, true);
    });

    it('follows the Link header next page to completion', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/pulls?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createPrFixture({ number: 1 })],
        headers: { Link: linkNext },
      });
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ number: 2 })] }); // no Link → stop
      const client = makeClient();
      const { prs, capReached } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        maxPrs: 200,
        deps: { client },
      });
      assert.equal(prs.length, 2);
      assert.equal(prs[0].number, 1);
      assert.equal(prs[1].number, 2);
      assert.equal(capReached, false);
      assert.equal(fakeGithub.calls.length, 2, 'exactly two pages must be fetched');
      assert.ok(fakeGithub.calls[1].url.includes('page=2'), 'the second request must follow the linked page');
    });

    it('follows Link next even when the page is short', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/pulls?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createPrFixture({ number: 1 })],
        headers: { Link: linkNext },
      });
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ number: 2 })] });
      const client = makeClient();
      const { prs } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        maxPrs: 200,
        deps: { client },
      });
      assert.equal(prs.length, 2, 'the server-authoritative Link wins over short-page termination');
      assert.equal(fakeGithub.calls.length, 2);
    });

    it('ignores a non-advancing Link next instead of looping', async () => {
      const linkSelf = `<${fakeUrl}/repos/owner/repo/pulls?per_page=100&page=1>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createPrFixture({ number: 1 })],
        headers: { Link: linkSelf },
      });
      const client = makeClient();
      const { prs, capReached } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        maxPrs: 200,
        deps: { client },
      });
      assert.equal(prs.length, 1);
      assert.equal(capReached, false);
      assert.equal(fakeGithub.calls.length, 1, 'a self-referential Link must not cause another fetch');
    });

    it('stops at the cap even when a Link next page exists', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/pulls?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 10 }, (_, i) => createPrFixture({ number: i })),
        headers: { Link: linkNext },
      });
      const client = makeClient();
      const { prs, capReached } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        maxPrs: 3,
        deps: { client },
      });
      assert.equal(prs.length, 3);
      assert.equal(capReached, true);
      assert.equal(fakeGithub.calls.length, 1, 'no further page may be fetched once capped');
    });

    it('filters by state', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ state: 'open' })] });
      const client = makeClient();
      await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { state: 'open', deps: { client } });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.ok(call.url.includes('state=open'));
    });

    it('rejects invalid state', async () => {
      const client = makeClient();
      await assert.rejects(
        fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { state: 'invalid', deps: { client } }),
        (err) => err.message.includes('Invalid PR state')
      );
    });

    it('handles pagination', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 100 }, (_, i) => createPrFixture({ number: i })),
      });
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 50 }, (_, i) => createPrFixture({ number: i + 100 })),
      });
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      const { prs, capReached } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        maxPrs: 200,
        deps: { client },
      });
      assert.equal(prs.length, 150);
      assert.equal(capReached, false);
    });

    it('propagates 401 as UNAUTHENTICATED without leaking the token', async () => {
      pushResponse(fakeGithub, { status: 401 });
      const client = makeClient();
      await assert.rejects(
        fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => {
          assert.ok(
            !JSON.stringify({ message: err.message, details: err.details }).includes(FAKE_GITHUB_TOKEN),
            'thrown errors must never carry the token'
          );
          return err.code === 'UNAUTHENTICATED';
        }
      );
    });

    it('propagates 404 as NOT_FOUND', async () => {
      pushResponse(fakeGithub, { status: 404 });
      const client = makeClient();
      await assert.rejects(
        fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'NOT_FOUND'
      );
    });

    it('propagates a bare 403 as UNAUTHENTICATED (T2.1 contract)', async () => {
      pushResponse(fakeGithub, { status: 403 });
      const client = makeClient();
      await assert.rejects(
        fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'UNAUTHENTICATED' && err.retryable === false
      );
    });

    it('propagates 500 as GITHUB_UNREACHABLE retryable', async () => {
      pushResponse(fakeGithub, { status: 500 });
      const client = makeClient();
      await assert.rejects(
        fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });

    it('propagates 422 as non-retryable without crashing', async () => {
      pushResponse(fakeGithub, { status: 422, body: { message: 'Validation Failed' } });
      const client = makeClient();
      await assert.rejects(
        fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.retryable === false
      );
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
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ number: 7 })] });
      const { prs, notModified } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client: gatedClient },
      });
      assert.equal(prs.length, 1);
      assert.equal(prs[0].number, 7);
      assert.equal(notModified, false);
      assert.deepEqual(sleeps, [60000], 'the gate must sleep exactly the retry window before retrying');
    });

    it('returns notModified on 304 without treating it as a failure', async () => {
      pushResponse(fakeGithub, { status: 304, body: '' });
      const client = makeClient();
      const { prs, notModified, capReached } = await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { etag: '"abc123"' },
        deps: { client },
      });
      assert.deepEqual(prs, []);
      assert.equal(notModified, true);
      assert.equal(capReached, false);
    });

    it('sends If-None-Match when the cursor carries an etag', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { etag: '"abc123"' },
        deps: { client },
      });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], '"abc123"');
    });

    it('sends no conditional header when the cursor has no etag', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      await fetchPullRequests(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], undefined);
    });
  });

  describe('fetchPullRequest', () => {
    it('fetches a single PR', async () => {
      pushResponse(fakeGithub, { status: 200, body: createPrFixture({ number: 99 }) });
      const client = makeClient();
      const pr = await fetchPullRequest(userDoc, 'owner', 'repo', 99, 'repo-id', { client });
      assert.equal(pr.number, 99);
    });

    it('returns null for 404', async () => {
      pushResponse(fakeGithub, { status: 404 });
      const client = makeClient();
      const pr = await fetchPullRequest(userDoc, 'owner', 'repo', 999, 'repo-id', { client });
      assert.equal(pr, null);
    });

    it('wraps network failure as typed retryable instead of throwing raw', async () => {
      const client = createGithubClient(userDoc, {
        gate: createRateLimitGate(),
        githubConfig: { apiBase: 'http://127.0.0.1:9999' },
      });
      await assert.rejects(
        fetchPullRequest(userDoc, 'owner', 'repo', 1, 'repo-id', { client }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });
  });

  describe('fetchPullRequestsForRepositories', () => {
    it('fetches PRs for multiple repositories', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ number: 1 })] });
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ number: 2 })] });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { prs, cursors, capReached, errors } = await fetchPullRequestsForRepositories(userDoc, repos, {
        deps: { client },
      });
      assert.equal(prs.length, 2);
      assert.ok(cursors.has('owner1/repo1'));
      assert.ok(cursors.has('owner2/repo2'));
      assert.equal(capReached, false);
      assert.equal(errors.size, 0);
    });

    it('reports per-repository progress with cursors in call order', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ number: 1 })] });
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ number: 2 })] });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const seen = [];
      await fetchPullRequestsForRepositories(userDoc, repos, {
        deps: { client },
        onProgress: async (info) => {
          seen.push(info);
        },
      });
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
      pushResponse(fakeGithub, { status: 200, body: [createPrFixture({ number: 2 })] }); // Second succeeds
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { prs, cursors, errors } = await fetchPullRequestsForRepositories(userDoc, repos, {
        deps: { client },
      });
      assert.equal(prs.length, 1);
      assert.equal(prs[0].number, 2);
      assert.ok(cursors.has('owner2/repo2'));
      assert.ok(!cursors.has('owner1/repo1'), 'a failed repo must not get a success cursor');
      assert.ok(errors.has('owner1/repo1'), 'the failure must be recorded, not swallowed');
      assert.equal(errors.get('owner1/repo1').code, 'NOT_FOUND');
    });
  });
});
