/**
 * Repositories fetcher tests (T2.2).
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);
process.env.SYNC_MAX_REPOS = '5';

const { encryptToken } = require('../src/services/auth/crypto.service');
const { createRateLimitGate } = require('../src/services/github/rateLimit');
const { createGithubClient } = require('../src/services/github/githubClient');
const { fetchRepositories, fetchRepository, normalizeRepo } = require('../src/services/github/repos.fetcher');
const { createFakeGithub, pushResponse, resetFake } = require('./test-helpers/fakeGithub');

const FAKE_GITHUB_TOKEN = 'fake-gh-token-t22';
const userDoc = { githubTokenEnc: encryptToken(FAKE_GITHUB_TOKEN) };

function createRepoFixture(overrides = {}) {
  return {
    id: 12345,
    name: 'test-repo',
    full_name: 'user/test-repo',
    owner: {
      login: 'user',
      id: 1,
      avatar_url: 'https://example.com/avatar.png',
      url: 'https://api.github.com/users/user',
      type: 'User',
    },
    private: false,
    visibility: 'public',
    language: 'JavaScript',
    stargazers_count: 10,
    fork: false,
    default_branch: 'main',
    updated_at: '2024-01-15T10:00:00Z',
    pushed_at: '2024-01-10T10:00:00Z',
    archived: false,
    disabled: false,
    description: 'A test repository',
    html_url: 'https://github.com/user/test-repo',
    clone_url: 'https://github.com/user/test-repo.git',
    ssh_url: 'git@github.com:user/test-repo.git',
    homepage: 'https://example.com',
    topics: ['test', 'javascript'],
    license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT' },
    ...overrides,
  };
}

describe('repos.fetcher (T2.2)', () => {
  let fakeGithub, fakeUrl, fakeClose;

  before(async () => {
    const created = createFakeGithub();
    fakeGithub = created.fake;
    fakeClose = created.close;
    await created.ready;
    fakeUrl = fakeGithub.url;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('fakeClose timeout')), 5000);
      fakeClose()
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch(reject);
    });
  });

  function makeClient() {
    return createGithubClient(userDoc, { gate: createRateLimitGate(), githubConfig: { apiBase: fakeUrl } });
  }

  beforeEach(() => resetFake(fakeGithub));

  describe('normalizeRepo', () => {
    it('normalizes a full repository object', () => {
      const repo = createRepoFixture();
      const dto = normalizeRepo(repo, { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.githubId, 12345);
      assert.equal(dto.owner, 'user');
      assert.equal(dto.name, 'test-repo');
      assert.equal(dto.fullName, 'user/test-repo');
      assert.equal(dto.visibility, 'public');
      assert.equal(dto.primaryLanguage, 'JavaScript');
      assert.equal(dto.stars, 10);
      assert.equal(dto.fork, false);
      assert.equal(dto.defaultBranch, 'main');
      assert.ok(dto.githubUpdatedAt instanceof Date);
      assert.ok(dto.pushedAt instanceof Date);
      assert.equal(dto.description, 'A test repository');
      assert.equal(dto.topics.length, 2);
      assert.ok(dto.license);
      assert.equal(dto.license.key, 'mit');
      assert.equal(dto.license.name, 'MIT License');
      assert.equal(dto.license.spdxId, 'MIT');
      assert.ok(dto.fetchedAt instanceof Date);
      assert.equal(dto.source, 'rest');
    });

    it('handles private repository', () => {
      const repo = createRepoFixture({ private: true, visibility: 'private' });
      const dto = normalizeRepo(repo, { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.visibility, 'private');
    });

    it('handles archived repository', () => {
      const repo = createRepoFixture({ archived: true });
      const dto = normalizeRepo(repo, { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.archived, true);
    });

    it('truncates long description', () => {
      const repo = createRepoFixture({ description: 'a'.repeat(600) });
      const dto = normalizeRepo(repo, { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.description.length, 500);
    });

    it('handles missing optional fields', () => {
      const repo = createRepoFixture({ description: null, license: null, topics: null, homepage: null });
      const dto = normalizeRepo(repo, { fetchedAt: new Date(), source: 'rest' });
      assert.equal(dto.description, null);
      assert.equal(dto.license, null);
      assert.deepEqual(dto.topics, []);
      assert.equal(dto.homepage, null);
    });
  });

  describe('fetchRepositories', () => {
    it('fetches repositories and returns normalized DTOs', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: [createRepoFixture({ id: 1, name: 'repo1' }), createRepoFixture({ id: 2, name: 'repo2' })],
      });
      const client = makeClient();
      const { repos, cursor, capReached } = await fetchRepositories(userDoc, { deps: { client } });
      assert.equal(repos.length, 2);
      assert.equal(repos[0].name, 'repo1');
      assert.equal(repos[1].name, 'repo2');
      assert.equal(capReached, false);
      assert.ok(cursor);
    });

    it('returns empty array for no repositories', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      const { repos } = await fetchRepositories(userDoc, { deps: { client } });
      assert.equal(repos.length, 0);
    });

    it('treats a malformed (non-array) body as an empty result, not a crash', async () => {
      pushResponse(fakeGithub, { status: 200, body: { unexpected: 'object' } });
      const client = makeClient();
      const { repos, capReached } = await fetchRepositories(userDoc, { deps: { client } });
      assert.deepEqual(repos, []);
      assert.equal(capReached, false);
    });

    it('respects maxRepos cap', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 10 }, (_, i) => createRepoFixture({ id: i, name: `repo${i}` })),
      });
      const client = makeClient();
      const { repos, capReached, cursor } = await fetchRepositories(userDoc, {
        maxRepos: 3,
        deps: { client },
      });
      assert.equal(repos.length, 3);
      assert.equal(capReached, true);
      assert.ok(cursor.page);
    });

    it('handles pagination (multiple pages)', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 100 }, (_, i) => createRepoFixture({ id: i, name: `repo${i}` })),
      });
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 50 }, (_, i) =>
          createRepoFixture({ id: i + 100, name: `repo${i + 100}` })
        ),
      });
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      const { repos, capReached } = await fetchRepositories(userDoc, { maxRepos: 200, deps: { client } });
      assert.equal(repos.length, 150);
      assert.equal(capReached, false);
    });

    it('follows the Link header next page to completion', async () => {
      const linkNext = `<${fakeUrl}/user/repos?per_page=100&page=2>; rel="next", <${fakeUrl}/user/repos?per_page=100&page=2>; rel="last"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createRepoFixture({ id: 1, name: 'repo1' })],
        headers: { Link: linkNext },
      });
      pushResponse(fakeGithub, { status: 200, body: [createRepoFixture({ id: 2, name: 'repo2' })] }); // no Link → stop
      const client = makeClient();
      const { repos, capReached } = await fetchRepositories(userDoc, { maxRepos: 200, deps: { client } });
      assert.equal(repos.length, 2);
      assert.equal(repos[0].name, 'repo1');
      assert.equal(repos[1].name, 'repo2');
      assert.equal(capReached, false);
      assert.equal(fakeGithub.calls.length, 2, 'exactly two pages must be fetched');
      assert.ok(fakeGithub.calls[1].url.includes('page=2'), 'the second request must follow the linked page');
    });

    it('follows Link next even when the page is short', async () => {
      const linkNext = `<${fakeUrl}/user/repos?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createRepoFixture({ id: 1 })],
        headers: { Link: linkNext },
      });
      pushResponse(fakeGithub, { status: 200, body: [createRepoFixture({ id: 2 })] });
      const client = makeClient();
      const { repos } = await fetchRepositories(userDoc, { maxRepos: 200, deps: { client } });
      assert.equal(repos.length, 2, 'the server-authoritative Link wins over short-page termination');
      assert.equal(fakeGithub.calls.length, 2);
    });

    it('ignores a non-advancing Link next instead of looping', async () => {
      const linkSelf = `<${fakeUrl}/user/repos?per_page=100&page=1>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: [createRepoFixture({ id: 1 })],
        headers: { Link: linkSelf },
      });
      const client = makeClient();
      const { repos, capReached } = await fetchRepositories(userDoc, { maxRepos: 200, deps: { client } });
      assert.equal(repos.length, 1);
      assert.equal(capReached, false);
      assert.equal(fakeGithub.calls.length, 1, 'a self-referential Link must not cause another fetch');
    });

    it('stops at the cap even when a Link next page exists', async () => {
      const linkNext = `<${fakeUrl}/user/repos?per_page=100&page=2>; rel="next"`;
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 10 }, (_, i) => createRepoFixture({ id: i, name: `repo${i}` })),
        headers: { Link: linkNext },
      });
      const client = makeClient();
      const { repos, capReached } = await fetchRepositories(userDoc, { maxRepos: 3, deps: { client } });
      assert.equal(repos.length, 3);
      assert.equal(capReached, true);
      assert.equal(fakeGithub.calls.length, 1, 'no further page may be fetched once capped');
    });

    it('stops at cap even with more pages available', async () => {
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 100 }, (_, i) => createRepoFixture({ id: i, name: `repo${i}` })),
      });
      pushResponse(fakeGithub, {
        status: 200,
        body: Array.from({ length: 100 }, (_, i) =>
          createRepoFixture({ id: i + 100, name: `repo${i + 100}` })
        ),
      });
      const client = makeClient();
      const { repos, capReached } = await fetchRepositories(userDoc, { maxRepos: 50, deps: { client } });
      assert.equal(repos.length, 50);
      assert.equal(capReached, true);
    });

    it('uses since cursor for incremental sync', async () => {
      pushResponse(fakeGithub, { status: 200, body: [createRepoFixture({ id: 1 })] });
      const client = makeClient();
      await fetchRepositories(userDoc, { cursor: { since: '2024-01-01T00:00:00Z' }, deps: { client } });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.ok(call.url.includes('since=2024-01-01T00%3A00%3A00Z'));
    });

    it('propagates 401 as UNAUTHENTICATED without leaking the token', async () => {
      pushResponse(fakeGithub, { status: 401, body: { message: 'Bad credentials' } });
      const client = makeClient();
      await assert.rejects(fetchRepositories(userDoc, { deps: { client } }), (err) => {
        assert.ok(
          !JSON.stringify({ message: err.message, details: err.details }).includes(FAKE_GITHUB_TOKEN),
          'thrown errors must never carry the token'
        );
        return err.code === 'UNAUTHENTICATED';
      });
    });

    it('propagates a bare 403 as UNAUTHENTICATED (T2.1 contract: reconnect required)', async () => {
      pushResponse(fakeGithub, { status: 403, body: { message: 'Forbidden' } });
      const client = makeClient();
      await assert.rejects(
        fetchRepositories(userDoc, { deps: { client } }),
        (err) => err.code === 'UNAUTHENTICATED' && err.retryable === false
      );
    });

    it('propagates 404 as NOT_FOUND', async () => {
      pushResponse(fakeGithub, { status: 404, body: { message: 'Not found' } });
      const client = makeClient();
      await assert.rejects(
        fetchRepositories(userDoc, { deps: { client } }),
        (err) => err.code === 'NOT_FOUND'
      );
    });

    it('propagates 500 as GITHUB_UNREACHABLE retryable', async () => {
      pushResponse(fakeGithub, { status: 500, body: { message: 'Internal server error' } });
      const client = makeClient();
      await assert.rejects(
        fetchRepositories(userDoc, { deps: { client } }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });

    it('handles network failure as retryable', async () => {
      const client = createGithubClient(userDoc, {
        gate: createRateLimitGate(),
        githubConfig: { apiBase: 'http://127.0.0.1:9999' },
      });
      await assert.rejects(fetchRepositories(userDoc, { deps: { client } }), (err) => err.retryable === true);
    });

    it('propagates 422 as non-retryable without crashing', async () => {
      pushResponse(fakeGithub, { status: 422, body: { message: 'Validation Failed' } });
      const client = makeClient();
      await assert.rejects(
        fetchRepositories(userDoc, { deps: { client } }),
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
      pushResponse(fakeGithub, { status: 200, body: [createRepoFixture({ id: 7, name: 'resumed' })] });
      const { repos, notModified } = await fetchRepositories(userDoc, { deps: { client: gatedClient } });
      assert.equal(repos.length, 1);
      assert.equal(repos[0].name, 'resumed');
      assert.equal(notModified, false);
      assert.deepEqual(sleeps, [60000], 'the gate must sleep exactly the retry window before retrying');
    });

    it('returns notModified on 304 without treating it as a failure', async () => {
      pushResponse(fakeGithub, { status: 304, body: '' });
      const client = makeClient();
      const incoming = { etag: '"abc123"', page: 1 };
      const { repos, notModified, capReached, cursor } = await fetchRepositories(userDoc, {
        cursor: incoming,
        deps: { client },
      });
      assert.deepEqual(repos, []);
      assert.equal(notModified, true);
      assert.equal(capReached, false);
      assert.deepEqual(cursor, incoming);
    });

    it('sends If-None-Match when the cursor carries an etag', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      await fetchRepositories(userDoc, { cursor: { etag: '"abc123"' }, deps: { client } });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], '"abc123"');
    });

    it('sends no conditional header when the cursor has no etag', async () => {
      pushResponse(fakeGithub, { status: 200, body: [] });
      const client = makeClient();
      await fetchRepositories(userDoc, { deps: { client } });
      const call = fakeGithub.calls[fakeGithub.calls.length - 1];
      assert.equal(call.headers['if-none-match'], undefined);
    });
  });

  describe('fetchRepository', () => {
    it('fetches a single repository', async () => {
      pushResponse(fakeGithub, { status: 200, body: createRepoFixture({ id: 42, name: 'single-repo' }) });
      const client = makeClient();
      const repo = await fetchRepository(userDoc, 'user', 'single-repo', { client });
      assert.equal(repo.name, 'single-repo');
      assert.equal(repo.githubId, 42);
    });

    it('returns null for 404', async () => {
      pushResponse(fakeGithub, { status: 404 });
      const client = makeClient();
      const repo = await fetchRepository(userDoc, 'user', 'nonexistent', { client });
      assert.equal(repo, null);
    });

    it('wraps network failure as typed retryable instead of throwing raw', async () => {
      const client = createGithubClient(userDoc, {
        gate: createRateLimitGate(),
        githubConfig: { apiBase: 'http://127.0.0.1:9999' },
      });
      await assert.rejects(
        fetchRepository(userDoc, 'user', 'repo', { client }),
        (err) => err.code === 'GITHUB_UNREACHABLE' && err.retryable === true
      );
    });
  });
});
