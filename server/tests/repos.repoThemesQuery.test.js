/**
 * Phase 10.2 — getCommitsByRepoIds query contract.
 *
 * The commit read for GET /api/repos is a single aggregation that:
 *   - is scoped to the AUTHENTICATED user and the repositories on the
 *     current page (never another user's commits, never the user's history
 *     across unrelated repositories);
 *   - applies the PER-REPOSITORY window INSIDE the pipeline, after the
 *     grouping — a global limit is not equivalent, because the busiest
 *     repository would consume the whole budget and quiet repositories would
 *     silently lose their evidence;
 *   - projects only the fields the classifier and the health rule need, and
 *     NEVER messageFull (commit bodies must not be read into memory);
 *   - sorts newest-first with a SHA tiebreak, so the result is deterministic.
 *
 * These are no-MongoDB unit tests (node:test mock.method, Node 24): the
 * aggregation pipeline is captured and asserted, so the contract is verified
 * without a database.
 */
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-16+';
process.env.TOKEN_ENC_KEY = 'ab'.repeat(32);

const { getCommitsByRepoIds } = require('../src/services/repos/repos.service');

// Same model instance the service imports, so mock.method is observed by it.
const CommitStub = require('../src/models/Commit');

const USER_ID = '64b64b64b64b64b64b64b64b';
const REPO_A = '64b64b64b64b64b64b64b64c';
const REPO_B = '64b64b64b64b64b64b64b64d';

/** Capture the aggregation pipeline the service builds. */
function fakeAggregate(rows = []) {
  const state = { pipeline: null, options: null };
  const chain = {
    exec: async () => {
      const stage = state.pipeline.find((s) => s.$group);
      if (!stage) return rows;
      // Emulate the $group + $slice stages so the grouping contract is real.
      const byRepo = new Map();
      for (const doc of rows) {
        const key = doc.repoId ? doc.repoId.toString() : null;
        if (!key) continue;
        if (!byRepo.has(key)) byRepo.set(key, []);
        byRepo.get(key).push(doc);
      }
      const slice = state.pipeline.find((s) => s.$project && s.$project.docs)?.$project?.docs?.$slice;
      const limit = Array.isArray(slice) ? slice[1] : null;
      return [...byRepo.entries()].map(([id, docs]) => ({
        _id: { toString: () => id },
        docs: limit ? docs.slice(0, limit) : docs,
      }));
    },
  };
  chain.state = state;
  return chain;
}

describe('getCommitsByRepoIds query contract (Phase 10.2)', () => {
  let captured;

  beforeEach(() => {
    captured = null;
    mock.method(CommitStub, 'aggregate', (pipeline, options) => {
      captured = fakeAggregate([]);
      captured.state.pipeline = pipeline;
      captured.state.options = options;
      return captured;
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('scopes the query to the authenticated user and the page repositories', async () => {
    await getCommitsByRepoIds(USER_ID, [REPO_A, REPO_B]);

    const match = captured.state.pipeline[0].$match;
    assert.equal(String(match.userId), USER_ID, 'must filter by the authenticated user');
    assert.equal(match.repoId.$in.length, 2, 'must filter by the repositories on the page');
    assert.equal(String(match.repoId.$in[0]), REPO_A);
    assert.equal(String(match.repoId.$in[1]), REPO_B);
  });

  it('never queries commits for a repository outside the page', async () => {
    await getCommitsByRepoIds(USER_ID, [REPO_A]);
    const ids = captured.state.pipeline[0].$match.repoId.$in.map(String);
    assert.equal(ids.length, 1);
    assert.ok(!ids.includes(REPO_B), 'a repository not on the page must never be queried');
  });

  it('applies the window PER REPOSITORY, after the grouping', async () => {
    await getCommitsByRepoIds(USER_ID, [REPO_A, REPO_B]);

    const stages = captured.state.pipeline;
    const groupIndex = stages.findIndex((s) => s.$group);
    const sliceIndex = stages.findIndex((s) => s.$project && s.$project.docs);
    assert.ok(groupIndex >= 0, 'the pipeline must group by repository');
    assert.ok(sliceIndex > groupIndex, 'the per-repository window must be applied AFTER the grouping');

    // A global limit would be applied before the grouping; this pipeline must
    // not carry one.
    assert.ok(!stages.some((s) => s.$limit), 'the pipeline must not apply a global limit');
  });

  it('caps each repository at the ingestion ceiling (500), independently', async () => {
    await getCommitsByRepoIds(USER_ID, [REPO_A, REPO_B]);

    const slice = captured.state.pipeline.find((s) => s.$project && s.$project.docs).$project.docs.$slice;
    assert.ok(Array.isArray(slice), 'the window must be a $slice on the grouped documents');
    assert.equal(slice[1], 500, 'each repository is capped at the ingestion ceiling');
  });

  it('the per-repository ceiling tracks SYNC_MAX_COMMITS_PER_REPO', async () => {
    const env = require('../src/config/env');
    const configured = env.getEnv().SYNC_MAX_COMMITS_PER_REPO;
    assert.equal(typeof configured, 'number');
    assert.ok(configured > 0, 'SYNC_MAX_COMMITS_PER_REPO must be a positive integer');
    assert.equal(configured, 500, 'the documented default ingestion ceiling is 500');
  });

  it('does not project commit bodies (messageFull)', async () => {
    await getCommitsByRepoIds(USER_ID, [REPO_A]);

    const project = captured.state.pipeline.find((s) => s.$project && !s.$project.docs).$project;
    const fields = Object.keys(project);
    assert.ok(!fields.includes('messageFull'), 'messageFull must never be selected');
    assert.ok(fields.includes('messageHeadline'), 'the headline is required by the classifier');
    assert.ok(fields.includes('authoredAt'), 'the date is required by the health rule');
  });

  it('sorts newest-first with a deterministic tiebreak', async () => {
    await getCommitsByRepoIds(USER_ID, [REPO_A]);
    const sort = captured.state.pipeline.find((s) => s.$sort).$sort;
    assert.equal(sort.authoredAt, -1, 'newest first');
    assert.equal(sort.sha, 1, 'a stable tiebreak keeps the window deterministic');
  });

  it('returns an empty map for an empty page without querying', async () => {
    const grouped = await getCommitsByRepoIds(USER_ID, []);
    assert.equal(grouped.size, 0);
    assert.equal(captured, null, 'no query must be issued for an empty page');
  });

  it('groups commits by repository id', async () => {
    mock.restoreAll();
    const rows = [
      { sha: 'a', repoId: { toString: () => REPO_A }, messageHeadline: 'fix: x' },
      { sha: 'b', repoId: { toString: () => REPO_A }, messageHeadline: 'feat: y' },
      { sha: 'c', repoId: { toString: () => REPO_B }, messageHeadline: 'docs: z' },
      { sha: 'd', repoId: null, messageHeadline: 'fix: orphan' },
    ];
    mock.method(CommitStub, 'aggregate', (pipeline) => {
      const chain = fakeAggregate(rows);
      chain.state.pipeline = pipeline;
      return chain;
    });

    const grouped = await getCommitsByRepoIds(USER_ID, [REPO_A, REPO_B]);
    assert.equal(grouped.size, 2, 'a commit without a repoId is ignored');
    assert.equal(grouped.get(REPO_A).length, 2);
    assert.equal(grouped.get(REPO_B).length, 1);
  });
});
