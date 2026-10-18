/**
 * Issues fetcher tests (T2.2).
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
process.env.SYNC_MAX_ISSUES_PER_REPO = '5';

const { encryptToken } = require('../src/services/auth/crypto.service');
const { createRateLimitGate } = require('../src/services/github/rateLimit');
const { createGithubClient } = require('../src/services/github/githubClient');
const {
  fetchIssues,
  fetchIssuesForRepositories,
  fetchIssue,
  normalizeIssue,
  isPullRequest,
} = require('../src/services/github/issues.fetcher');
const { createFakeGithub, pushResponse, resetFake } = require('./test-helpers/fakeGithub');

const FAKE_GITHUB_TOKEN = 'fake-gh-token-t22';
const userDoc = { githubTokenEnc: encryptToken(FAKE_GITHUB_TOKEN) };

function createIssueFixture(overrides = {}) {
  return {
    number: 42,
    state: 'open',
    title: 'Bug in authentication',
    body: 'Login fails when password contains special chars\n\nSteps to reproduce...',
    created_at: '2024-01-10T10:00:00Z',
    updated_at: '2024-01-12T10:00:00Z',
    closed_at: null,
    user: { login: 'reporter', id: 1, avatar_url: 'https://example.com/avatar.png' },
    author_association: 'CONTRIBUTOR',
    assignees: [{ login: 'assignee1', id: 2, avatar_url: 'https://example.com/avatar2.png' }],
    labels: [
      { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
      { name: 'high-priority', color: 'b60205', description: 'High priority' },
    ],
    comments: 5,
    locked: false,
    milestone: { number: 1, title: 'v1.0', state: 'open', due_on: '2024-02-01T00:00:00Z' },
    ...overrides,
  };
}

function createPrAsIssueFixture(overrides = {}) {
  return {
    ...createIssueFixture(overrides),
    pull_request: {
      url: 'https://api.github.com/repos/owner/repo/pulls/42',
      html_url: 'https://github.com/owner/repo/pull/42',
      diff_url: 'https://github.com/owner/repo/pull/42.diff',
      patch_url: 'https://github.com/owner/repo/pull/42.patch',
    },
  };
}

describe('issues.fetcher (T2.2)', () => {
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

  describe('isPullRequest', () => {
    it('returns true for PR objects', () => {
      const pr = createPrAsIssueFixture();
      assert.equal(isPullRequest(pr), true);
    });

    it('returns false for regular issues', () => {
      const issue = createIssueFixture();
      assert.equal(isPullRequest(issue), false);
    });
  });

  describe('normalizeIssue', () => {
    it('normalizes a full issue object', () => {
      const issue = createIssueFixture();
      const dto = normalizeIssue(issue, 'repo-id-123', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.number, 42);
      assert.equal(dto.repoId, 'repo-id-123');
      assert.equal(dto.state, 'open');
      assert.equal(dto.title, 'Bug in authentication');
      assert.equal(dto.body, 'Login fails when password contains special chars\n\nSteps to reproduce...');
      assert.ok(dto.createdAt instanceof Date);
      assert.ok(dto.updatedAt instanceof Date);
      assert.equal(dto.closedAt, null);
      assert.equal(dto.author.login, 'reporter');
      assert.equal(dto.assignees.length, 1);
      assert.equal(dto.labels.length, 2);
      assert.equal(dto.labels[0].name, 'bug');
      assert.equal(dto.comments, 5);
      assert.ok(dto.milestone);
      assert.equal(dto.milestone.number, 1);
    });

    it('returns null for pull requests', () => {
      const pr = createPrAsIssueFixture();
      const dto = normalizeIssue(pr, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto, null);
    });

    it('truncates long title and body', () => {
      const issue = createIssueFixture({ title: 'a'.repeat(300), body: 'b'.repeat(600) });
      const dto = normalizeIssue(issue, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.title.length, 200);
      assert.equal(dto.body.length, 500);
    });

    it('handles missing optional fields', () => {
      const issue = createIssueFixture({
        body: null,
        assignees: null,
        labels: null,
        milestone: null,
        closed_at: '2024-01-15T10:00:00Z',
      });
      const dto = normalizeIssue(issue, 'repo-id', { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.body, null);
      assert.deepEqual(dto.assignees, []);
      assert.deepEqual(dto.labels, []);
      assert.equal(dto.milestone, null);
      assert.ok(dto.closedAt instanceof Date);
    });
  });

  describe('fetchIssues', () => {
    it('fetches issues and returns normalized DTOs', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: [createIssueFixture({ number: 1 }), createIssueFixture({ number: 2 })],
      });
      const client = makeClient();
      const { issues, capReached } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client },
      });
      assert.equal(issues.length, 2);
      assert.equal(issues[0].number, 1);
      assert.equal(capReached, false);
    });

    it('skips pull requests in issues response', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: [
          createIssueFixture({ number: 1 }),
          createPrAsIssueFixture({ number: 2 }),
          createIssueFixture({ number: 3 }),
        ],
      });
      const client = makeClient();
      const { issues } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } });
      assert.equal(issues.length, 2);
      assert.equal(issues[0].number, 1);
      assert.equal(issues[1].number, 3);
    });

    it('returns empty array for no issues', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      const { issues } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } });
      assert.equal(issues.length, 0);
    });

    it('treats a malformed (non-array) body as an empty result, not a crash', async () => {
      pushResponse(fakeGithub, { status: 200, body: { unexpected: 'object' } });
      const client = makeClient();
      const { issues, capReached } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client },
      });
      assert.deepEqual(issues, []);
      assert.equal(capReached, false);
    });

    it('treats network failure as retryable', async () => {
      const client = createGithubClient(userDoc, {
        gate: createRateLimitGate(),
        githubConfig: { apiBase: 'http://127.0.0.1:9999' },
      });
      await assert.rejects(
        fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.retryable === true
      );
    });

    it('returns empty array when only PRs returned', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: [createPrAsIssueFixture({ number: 1 }), createPrAsIssueFixture({ number: 2 })],
      });
      const client = makeClient();
      const { issues } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } });
      assert.equal(issues.length, 0);
    });

    it('respects maxIssues cap', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 10 }, (_, i) => createIssueFixture({ number: i })),
      });
      const client = makeClient();
      const { issues, capReached } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        maxIssues: 3,
        deps: { client },
      });
      assert.equal(issues.length, 3);
      assert.equal(capReached, true);
    });

    it('follows the Link header next page to completion', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/issues?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createIssueFixture({ number: 1 })],
        headers: { Link: linkNext },
      });
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ number: 2 })] }); // no Link → stop
      const client = makeClient();
      const { issues, capReached } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        maxIssues: 200,
        deps: { client },
      });
      assert.equal(issues.length, 2);
      assert.equal(issues[0].number, 1);
      assert.equal(issues[1].number, 2);
      assert.equal(capReached, false);
      assert.equal(fakeGithub.calls.length, 2, 'exactly two pages must be fetched');
      assert.ok(fakeGithub.calls[1].url.includes('page=2'), 'the second request must follow the linked page');
    });

    it('follows Link next even when the page is short', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/issues?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createIssueFixture({ number: 1 })],
        headers: { Link: linkNext },
      });
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ number: 2 })] });
      const client = makeClient();
      const { issues } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        maxIssues: 200,
        deps: { client },
      });
      assert.equal(issues.length, 2, 'the server-authoritative Link wins over short-page termination');
      assert.equal(fakeGithub.calls.length, 2);
    });

    it('ignores a non-advancing Link next instead of looping', async () => {
      const linkSelf = `<${fakeUrl}/repos/owner/repo/issues?per_page=100&page=1>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createIssueFixture({ number: 1 })],
        headers: { Link: linkSelf },
      });
      const client = makeClient();
      const { issues, capReached } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        maxIssues: 200,
        deps: { client },
      });
      assert.equal(issues.length, 1);
      assert.equal(capReached, false);
      assert.equal(fakeGithub.calls.length, 1, 'a self-referential Link must not cause another fetch');
    });

    it('stops at the cap even when a Link next page exists', async () => {
      const linkNext = `<${fakeUrl}/repos/owner/repo/issues?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 10 }, (_, i) => createIssueFixture({ number: i })),
        headers: { Link: linkNext },
      });
      const client = makeClient();
      const { issues, capReached } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        maxIssues: 3,
        deps: { client },
      });
      assert.equal(issues.length, 3);
      assert.equal(capReached, true);
      assert.equal(fakeGithub.calls.length, 1, 'no further page may be fetched once capped');
    });

    it('filters by state', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ state: 'open' })] });
      const client = makeClient();
      await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { state: 'closed', deps: { client } });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.ok(call.url.includes('state=closed'));
    });

    it('uses since cursor for incremental sync', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture()] });
      const client = makeClient();
      await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { since: '2024-01-01T00:00:00Z' },
        deps: { client },
      });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.ok(call.url.includes('since=2024-01-01T00%3A00%3A00Z'));
    });

    it('handles pagination', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 100 }, (_, i) => createIssueFixture({ number: i })),
      });
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 50 }, (_, i) => createIssueFixture({ number: i + 100 })),
      });
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      const { issues, capReached } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        maxIssues: 200,
        deps: { client },
      });
      assert.equal(issues.length, 150);
      assert.equal(capReached, false);
    });

    it('propagates 401 as UNAUTHENTICATED without leaking the token', async () => {
      pushResponse(fakeGithub, { status: 401 });
      const client = makeClient();
      await assert.rejects(fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }), (err) => {
        assert.ok(
          !JSON.stringify({ message: err.message, details: err.details }).includes(FAKE_GITHUB_TOKEN),
          'thrown errors must never carry the token'
        );
        return err.code === 'UNAUTHENTICATED';
      });
    });

    it('propagates 404 as NOT_FOUND', async () => {
      pushResponse(fakeGithub, { status: 404 });
      const client = makeClient();
      await assert.rejects(
        fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'NOT_FOUND'
      );
    });

    it('propagates a bare 403 as UNAUTHENTICATED (T2.1 contract)', async () => {
      pushResponse(fakeGithub, { status: 403 });
      const client = makeClient();
      await assert.rejects(
        fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'UNAUTHENTICATED' && err.retryable === false
      );
    });

    it('propagates 500 as GITHUB_UNREACHABLE retryable', async () => {
      pushResponse(fakeGithub, { status: 500 });
      const client = makeClient();
      await assert.rejects(
        fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });

    it('propagates 422 as non-retryable without crashing', async () => {
      pushResponse(fakeGithub, { status: 422, body: { message: 'Validation Failed' } });
      const client = makeClient();
      await assert.rejects(
        fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } }),
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
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ number: 7 })] });
      const { issues, notModified } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        deps: { client: gatedClient },
      });
      assert.equal(issues.length, 1);
      assert.equal(issues[0].number, 7);
      assert.equal(notModified, false);
      assert.deepEqual(sleeps, [60000], 'the gate must sleep exactly the retry window before retrying');
    });

    it('returns notModified on 304 without treating it as a failure', async () => {
      pushResponse(fakeGithub, { status: 304, body: '' });
      const client = makeClient();
      const { issues, notModified, capReached } = await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { etag: '"abc123"' },
        deps: { client },
      });
      assert.deepEqual(issues, []);
      assert.equal(notModified, true);
      assert.equal(capReached, false);
    });

    it('sends If-None-Match when the cursor carries an etag', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', {
        cursor: { etag: '"abc123"' },
        deps: { client },
      });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], '"abc123"');
    });

    it('sends no conditional header when the cursor has no etag', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      await fetchIssues(userDoc, 'owner', 'repo', 'repo-id', { deps: { client } });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], undefined);
    });
  });

  describe('fetchIssue', () => {
    it('fetches a single issue', async () => {
      pushResponse(fakeGithub, { status: 200, body: createIssueFixture({ number: 99 }) });
      const client = makeClient();
      const issue = await fetchIssue(userDoc, 'owner', 'repo', 99, 'repo-id', { client });
      assert.equal(issue.number, 99);
    });

    it('returns null for PR', async () => {
      pushResponse(fakeGithub, { status: 200, body: createPrAsIssueFixture({ number: 99 }) });
      const client = makeClient();
      const issue = await fetchIssue(userDoc, 'owner', 'repo', 99, 'repo-id', { client });
      assert.equal(issue, null);
    });

    it('returns null for 404', async () => {
      pushResponse(fakeGithub, { status: 404 });
      const client = makeClient();
      const issue = await fetchIssue(userDoc, 'owner', 'repo', 999, 'repo-id', { client });
      assert.equal(issue, null);
    });

    it('wraps network failure as typed retryable instead of throwing raw', async () => {
      const client = createGithubClient(userDoc, {
        gate: createRateLimitGate(),
        githubConfig: { apiBase: 'http://127.0.0.1:9999' },
      });
      await assert.rejects(
        fetchIssue(userDoc, 'owner', 'repo', 1, 'repo-id', { client }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });
  });

  describe('fetchIssuesForRepositories', () => {
    it('fetches issues for multiple repositories', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ number: 1 })] });
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ number: 2 })] });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { issues, cursors, capReached, errors } = await fetchIssuesForRepositories(userDoc, repos, {
        deps: { client },
      });
      assert.equal(issues.length, 2);
      assert.ok(cursors.has('owner1/repo1'));
      assert.ok(cursors.has('owner2/repo2'));
      assert.equal(capReached, false);
      assert.equal(errors.size, 0);
    });

    it('reports per-repository progress with cursors in call order', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ number: 1 })] });
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ number: 2 })] });
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const seen = [];
      await fetchIssuesForRepositories(userDoc, repos, {
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
      pushResponse(fakeGithub, { status: 200, body: [createIssueFixture({ number: 2 })] }); // Second succeeds
      const client = makeClient();
      const repos = [
        { owner: 'owner1', name: 'repo1', repoId: 'repo-id-1' },
        { owner: 'owner2', name: 'repo2', repoId: 'repo-id-2' },
      ];
      const { issues, cursors, errors } = await fetchIssuesForRepositories(userDoc, repos, {
        deps: { client },
      });
      assert.equal(issues.length, 1);
      assert.equal(issues[0].number, 2);
      assert.ok(cursors.has('owner2/repo2'));
      assert.ok(!cursors.has('owner1/repo1'), 'a failed repo must not get a success cursor');
      assert.ok(errors.has('owner1/repo1'), 'the failure must be recorded, not swallowed');
      assert.equal(errors.get('owner1/repo1').code, 'NOT_FOUND');
    });
  });
});
