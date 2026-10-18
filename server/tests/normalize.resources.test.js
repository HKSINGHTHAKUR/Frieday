/**
 * Normalizer unit tests, part 2 (T3.2): pull-request, issue, and language
 * normalizers. Pure functions only — no database, no network.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { normalizePullRequest } = require('../src/services/normalization/normalize.pulls');
const { normalizeIssue } = require('../src/services/normalization/normalize.issues');
const { normalizeLanguages } = require('../src/services/normalization/normalize.languages');

const oid = () => new mongoose.Types.ObjectId();
const USER_ID = oid();
const REPO_ID = oid();
const MAP = new Map([[11, REPO_ID]]);
const PROVENANCE = { fetchedAt: new Date('2024-02-01T00:00:00Z'), source: 'rest' };

function prDto(overrides = {}) {
  return {
    number: 7,
    repoId: '11',
    state: 'open',
    title: 'Add feature',
    body: 'Please review',
    createdAt: new Date('2024-01-10T00:00:00Z'),
    updatedAt: new Date('2024-01-12T00:00:00Z'),
    closedAt: null,
    mergedAt: null,
    author: { login: 'octo', id: 1, avatarUrl: null },
    authorAssociation: 'OWNER',
    draft: false,
    additions: 100,
    deletions: 20,
    changedFiles: 5,
    commits: 3,
    comments: 2,
    reviewComments: 1,
    baseRef: 'main',
    baseSha: 'b0',
    baseRepo: { id: 42, fullName: 'octo/demo' },
    headRef: 'feature',
    headSha: 'h0',
    headRepo: { id: 42, fullName: 'octo/demo' },
    mergeable: true,
    mergeableState: 'clean',
    merged: false,
    mergedBy: null,
    requestedReviewers: [{ login: 'rev', id: 2, avatarUrl: null }],
    reviewers: [],
    labels: ['enhancement'],
    ...PROVENANCE,
    ...overrides,
  };
}

function issueDto(overrides = {}) {
  return {
    number: 9,
    repoId: '11',
    state: 'open',
    title: 'Bug report',
    body: 'Steps to reproduce',
    createdAt: new Date('2024-01-10T00:00:00Z'),
    updatedAt: new Date('2024-01-12T00:00:00Z'),
    closedAt: null,
    author: { login: 'octo', id: 1, avatarUrl: null },
    authorAssociation: 'CONTRIBUTOR',
    assignees: [{ login: 'helper', id: 3, avatarUrl: null }],
    labels: [{ name: 'bug', color: 'red', description: 'Broken' }],
    comments: 4,
    locked: false,
    milestone: { number: 3, title: 'v1', state: 'open', dueOn: new Date('2024-03-01T00:00:00Z') },
    ...PROVENANCE,
    ...overrides,
  };
}

describe('normalizePullRequest (T3.2)', () => {
  const CTX = { userId: USER_ID, userLogin: 'octo', repoIdMap: MAP };

  it('maps a valid DTO with computed ownership flags', () => {
    const doc = normalizePullRequest(prDto(), CTX);
    assert.equal(doc.number, 7);
    assert.equal(String(doc.repoId), String(REPO_ID));
    assert.equal(doc.state, 'open');
    assert.equal(doc.authorLogin, 'octo');
    assert.equal(doc.isAuthoredByUser, true);
    assert.equal(doc.isReviewedByUser, false);
    assert.equal(doc.baseRef, 'main');
    assert.equal(doc.requestedReviewers[0].login, 'rev');
    assert.deepEqual(doc.labels, ['enhancement']);
  });

  it('flags reviewed-but-not-authored work', () => {
    const doc = normalizePullRequest(
      prDto({
        author: { login: 'other', id: 9, avatarUrl: null },
        reviewers: [{ login: 'octo', id: 1, avatarUrl: null }],
      }),
      CTX
    );
    assert.equal(doc.isAuthoredByUser, false);
    assert.equal(doc.isReviewedByUser, true);
  });

  it('drops flags safely when the login is unknown or authors are missing', () => {
    const doc = normalizePullRequest(prDto({ author: null }), {
      userId: USER_ID,
      userLogin: null,
      repoIdMap: MAP,
    });
    assert.equal(doc.author, null);
    assert.equal(doc.authorLogin, null);
    assert.equal(doc.isAuthoredByUser, false);
    assert.equal(doc.isReviewedByUser, false);
  });

  it('rejects null input, missing number, missing title, and bad state', () => {
    assert.throws(
      () => normalizePullRequest(null, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizePullRequest({ ...prDto(), number: 0 }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizePullRequest({ ...prDto(), title: '' }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizePullRequest({ ...prDto(), state: 'draft' }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects unknown repos, bad timestamps, and missing provenance', () => {
    assert.throws(
      () => normalizePullRequest(prDto({ repoId: '999' }), CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizePullRequest({ ...prDto(), createdAt: 'yesterday-ish' }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    const noProv = { ...prDto() };
    delete noProv.fetchedAt;
    assert.throws(
      () => normalizePullRequest(noProv, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('truncates title/body at the documented bounds, deterministically', () => {
    const dto = prDto({ title: 't'.repeat(250), body: 'b'.repeat(600) });
    const before = JSON.stringify(dto);
    const a = normalizePullRequest(dto, CTX);
    assert.equal(a.title.length, 200);
    assert.equal(a.body.length, 500);
    assert.deepEqual(a, normalizePullRequest(dto, CTX));
    assert.equal(JSON.stringify(dto), before, 'input DTO must be untouched');
  });

  it('accepts exact-boundary values as-is', () => {
    const doc = normalizePullRequest(prDto({ title: 't'.repeat(200) }), CTX);
    assert.equal(doc.title.length, 200);
  });

  it('drops secret-looking fields instead of persisting them', () => {
    const doc = normalizePullRequest(prDto({ githubTokenEnc: 'MARKER-SECRET', token: 'MARKER' }), CTX);
    assert.ok(!JSON.stringify(doc).includes('MARKER'));
  });
});

describe('normalizeIssue (T3.2)', () => {
  const CTX = { userId: USER_ID, userLogin: 'octo', repoIdMap: MAP };

  it('maps a valid DTO with labels, assignees, and milestone', () => {
    const doc = normalizeIssue(issueDto(), CTX);
    assert.equal(doc.number, 9);
    assert.equal(String(doc.repoId), String(REPO_ID));
    assert.equal(doc.authorLogin, 'octo');
    assert.equal(doc.isAuthoredByUser, true);
    assert.equal(doc.labels[0].name, 'bug');
    assert.equal(doc.assignees[0].login, 'helper');
    assert.equal(doc.milestone.title, 'v1');
  });

  it('rejects null input, missing number/title, bad state, and bad timestamps', () => {
    assert.throws(
      () => normalizeIssue(null, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeIssue({ ...issueDto(), number: -2 }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeIssue({ ...issueDto(), title: '' }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeIssue({ ...issueDto(), state: 'stale' }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeIssue({ ...issueDto(), createdAt: null }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('handles missing authors, empty arrays, and malformed nested objects', () => {
    const doc = normalizeIssue(
      issueDto({ author: null, assignees: 'nope', labels: [{ name: 'x' }, 42, null], milestone: 'nope' }),
      CTX
    );
    assert.equal(doc.author, null);
    assert.equal(doc.isAuthoredByUser, false);
    assert.deepEqual(doc.assignees, []);
    assert.equal(doc.labels.length, 1);
    assert.equal(doc.milestone, null);
  });

  it('truncates title/body deterministically without mutating input', () => {
    const dto = issueDto({ title: 't'.repeat(250), body: 'b'.repeat(600) });
    const before = JSON.stringify(dto);
    const a = normalizeIssue(dto, CTX);
    assert.equal(a.title.length, 200);
    assert.equal(a.body.length, 500);
    assert.deepEqual(a, normalizeIssue(dto, CTX));
    assert.equal(JSON.stringify(dto), before);
  });

  it('rejects missing provenance and unknown repos', () => {
    const noSource = { ...issueDto() };
    delete noSource.source;
    assert.throws(
      () => normalizeIssue(noSource, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeIssue(issueDto({ repoId: '999' }), CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('drops secret-looking fields instead of persisting them', () => {
    const doc = normalizeIssue(issueDto({ cookie: 'MARKER-SECRET' }), CTX);
    assert.ok(!JSON.stringify(doc).includes('MARKER'));
  });
});

describe('normalizeLanguages (T3.2)', () => {
  const CTX = { userId: USER_ID, repoIdMap: MAP };

  it('converts the DTO array into a bytes map', () => {
    const doc = normalizeLanguages(
      {
        repoId: '11',
        languages: [
          { language: 'JavaScript', bytes: 9000 },
          { language: 'CSS', bytes: 1000 },
        ],
        ...PROVENANCE,
      },
      CTX
    );
    assert.equal(String(doc.repoId), String(REPO_ID));
    assert.deepEqual(doc.bytes, { JavaScript: 9000, CSS: 1000 });
    assert.ok(doc.fetchedAt instanceof Date);
    assert.equal(doc.source, 'rest');
  });

  it('rejects null input, unknown repos, and missing provenance', () => {
    assert.throws(
      () => normalizeLanguages(null, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeLanguages({ repoId: '999', languages: [], ...PROVENANCE }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeLanguages({ repoId: '11', languages: [], fetchedAt: 'soon-ish', source: 'rest' }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeLanguages({ repoId: '11', languages: [], fetchedAt: new Date(), source: 'smoke' }, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('sanitizes malformed entries instead of crashing', () => {
    const doc = normalizeLanguages(
      {
        repoId: '11',
        languages: [
          { language: 'Go', bytes: 50 },
          { language: '', bytes: 5 },
          null,
          42,
          { language: 'Rust', bytes: 'lots' },
        ],
        ...PROVENANCE,
      },
      CTX
    );
    assert.deepEqual(doc.bytes, { Go: 50, Rust: 0 });
  });

  it('is deterministic and never mutates the input', () => {
    const dto = { repoId: '11', languages: [{ language: 'Go', bytes: 1 }], ...PROVENANCE };
    const before = JSON.stringify(dto);
    assert.deepEqual(normalizeLanguages(dto, CTX), normalizeLanguages(dto, CTX));
    assert.equal(JSON.stringify(dto), before);
  });

  it('normalizes concurrently without shared state', async () => {
    const dto = { repoId: '11', languages: [{ language: 'Go', bytes: 1 }], ...PROVENANCE };
    const results = await Promise.all([normalizeLanguages(dto, CTX), normalizeLanguages(dto, CTX)]);
    assert.deepEqual(results[0], results[1]);
  });
});
