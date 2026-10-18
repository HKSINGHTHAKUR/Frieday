/**
 * Normalizer unit tests, part 1 (T3.2): shared primitives + repository and
 * commit normalizers. Pure functions only — no database, no network.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  truncate,
  validationError,
  asDate,
  checkEnum,
  asCount,
} = require('../src/services/normalization/normalize.common');
const { normalizeRepository } = require('../src/services/normalization/normalize.repos');
const { normalizeCommit } = require('../src/services/normalization/normalize.commits');

const oid = () => new mongoose.Types.ObjectId();
const USER_ID = oid();
const CTX = { userId: USER_ID };
const PROVENANCE = { fetchedAt: new Date('2024-02-01T00:00:00Z'), source: 'rest' };

function repoDto(overrides = {}) {
  return {
    githubId: 42,
    owner: 'octo',
    name: 'demo',
    fullName: 'octo/demo',
    visibility: 'public',
    primaryLanguage: 'JavaScript',
    stars: 10,
    fork: false,
    defaultBranch: 'main',
    githubUpdatedAt: new Date('2024-01-15T00:00:00Z'),
    pushedAt: new Date('2024-01-10T00:00:00Z'),
    archived: false,
    disabled: false,
    description: 'A demo repo',
    htmlUrl: 'https://github.com/octo/demo',
    cloneUrl: 'https://github.com/octo/demo.git',
    sshUrl: 'git@github.com:octo/demo.git',
    homepage: null,
    topics: ['demo'],
    license: { key: 'mit', name: 'MIT', spdxId: 'MIT' },
    ...PROVENANCE,
    ...overrides,
  };
}

function commitDto(overrides = {}) {
  return {
    sha: 'abc123',
    repoId: '11',
    messageHeadline: 'Fix it',
    messageFull: 'Fix it\n\nDetails',
    authoredAt: new Date('2024-01-15T00:00:00Z'),
    committedAt: new Date('2024-01-15T00:00:00Z'),
    author: { login: 'octo', id: 1, avatarUrl: 'https://example.com/a.png' },
    committer: { login: 'octo', id: 1, avatarUrl: 'https://example.com/a.png' },
    additions: 10,
    deletions: 2,
    total: 12,
    files: ['a.js', 'b.js'],
    parents: ['p1'],
    ...PROVENANCE,
    ...overrides,
  };
}

describe('normalize.common (T3.2)', () => {
  it('builds typed validation errors', () => {
    const err = validationError('commit', 'Bad sha.', { resource: 'commit' });
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.retryable, false);
  });

  it('parses required vs optional timestamps', () => {
    const at = asDate('2024-01-01T00:00:00Z', { field: 'f', resource: 'r', identity: {}, required: true });
    assert.ok(at instanceof Date);
    assert.equal(asDate('garbage', { field: 'f', resource: 'r', identity: {}, required: false }), null);
    assert.throws(
      () => asDate('garbage', { field: 'f', resource: 'r', identity: {}, required: true }),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.equal(asDate(null, { field: 'f', resource: 'r', identity: {}, required: false }), null);
  });

  it('rejects unknown enum values', () => {
    assert.equal(checkEnum('a', ['a', 'b'], 'f', 'r', {}), 'a');
    assert.throws(
      () => checkEnum('z', ['a', 'b'], 'f', 'r', {}),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('coerces counts leniently without ever going negative', () => {
    assert.equal(asCount(5), 5);
    assert.equal(asCount(-3), 0);
    assert.equal(asCount('x', 7), 7);
    assert.equal(asCount(NaN, 7), 7);
  });

  it('truncates deterministically', () => {
    assert.equal(truncate('abcdef', 3), 'abc');
    assert.equal(truncate(truncate('abcdef', 3), 3), 'abc');
  });
});

describe('normalizeRepository (T3.2)', () => {
  it('maps a valid DTO to a complete document', () => {
    const doc = normalizeRepository(repoDto(), CTX);
    assert.equal(String(doc.userId), String(USER_ID));
    assert.equal(doc.githubId, 42);
    assert.equal(doc.fullName, 'octo/demo');
    assert.equal(doc.visibility, 'public');
    assert.equal(doc.stars, 10);
    assert.equal(doc.license.key, 'mit');
    assert.deepEqual(doc.topics, ['demo']);
    assert.equal(doc.lastSyncedAt, null);
    assert.ok(doc.fetchedAt instanceof Date);
    assert.equal(doc.source, 'rest');
  });

  it('rejects null, undefined, and non-object input', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      assert.throws(
        () => normalizeRepository(bad, CTX),
        (e) => e.code === 'VALIDATION_ERROR'
      );
    }
  });

  it('rejects missing identity and provenance', () => {
    const noId = { ...repoDto() };
    delete noId.githubId;
    assert.throws(
      () => normalizeRepository(noId, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    const noProv = { ...repoDto() };
    delete noProv.fetchedAt;
    assert.throws(
      () => normalizeRepository(noProv, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    const badSource = repoDto({ source: 'pigeon' });
    assert.throws(
      () => normalizeRepository(badSource, CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeRepository(repoDto(), {}),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects unknown visibility instead of inventing a mapping', () => {
    assert.throws(
      () => normalizeRepository(repoDto({ visibility: 'hidden' }), CTX),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('is deterministic and never mutates the input', () => {
    const dto = repoDto({ description: 'x'.repeat(600) });
    const before = JSON.stringify(dto);
    const a = normalizeRepository(dto, CTX);
    const b = normalizeRepository(dto, CTX);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(dto), before, 'input DTO must be untouched');
    assert.equal(a.description.length, 500);
  });

  it('accepts boundary values and handles empty optionals', () => {
    const doc = normalizeRepository(
      repoDto({ description: null, homepage: undefined, topics: [], license: null }),
      CTX
    );
    assert.equal(doc.description, null);
    assert.deepEqual(doc.topics, []);
    assert.equal(doc.license, null);
  });

  it('drops unknown and secret-looking fields instead of persisting them', () => {
    const doc = normalizeRepository(repoDto({ githubTokenEnc: 'MARKER-SECRET', auth: 'MARKER' }), CTX);
    const keys = JSON.stringify(doc);
    assert.ok(!keys.includes('MARKER'), 'unknown fields must never reach the document');
    assert.ok(!('githubTokenEnc' in doc) && !('auth' in doc));
  });

  it('scopes the same GitHub repo per user without collision', () => {
    const other = oid();
    const a = normalizeRepository(repoDto(), { userId: USER_ID });
    const b = normalizeRepository(repoDto(), { userId: other });
    assert.equal(a.githubId, b.githubId);
    assert.ok(String(a.userId) !== String(b.userId));
  });
});

describe('normalizeCommit (T3.2)', () => {
  const MAP = new Map([[11, oid()]]);

  it('maps a valid DTO, resolving the repo reference', () => {
    const doc = normalizeCommit(commitDto(), { userId: USER_ID, repoIdMap: MAP });
    assert.equal(doc.sha, 'abc123');
    assert.equal(String(doc.repoId), String(MAP.get(11)));
    assert.equal(doc.messageHeadline, 'Fix it');
    assert.equal(doc.author.login, 'octo');
    assert.equal(doc.additions, 10);
    assert.deepEqual(doc.files, ['a.js', 'b.js']);
    assert.ok(doc.authoredAt instanceof Date);
  });

  it('rejects null input, missing sha, and missing author date', () => {
    assert.throws(
      () => normalizeCommit(null, { userId: USER_ID, repoIdMap: MAP }),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeCommit({ ...commitDto(), sha: '' }, { userId: USER_ID, repoIdMap: MAP }),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () =>
        normalizeCommit({ ...commitDto(), authoredAt: 'not-a-date' }, { userId: USER_ID, repoIdMap: MAP }),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects unknown or malformed repository references', () => {
    assert.throws(
      () => normalizeCommit(commitDto({ repoId: '999' }), { userId: USER_ID, repoIdMap: MAP }),
      (e) => e.code === 'VALIDATION_ERROR'
    );
    assert.throws(
      () => normalizeCommit(commitDto({ repoId: 'nope' }), { userId: USER_ID, repoIdMap: MAP }),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('accepts commits without a GitHub user attached', () => {
    const doc = normalizeCommit(commitDto({ author: null, committer: undefined }), {
      userId: USER_ID,
      repoIdMap: MAP,
    });
    assert.equal(doc.author, null);
    assert.equal(doc.committer, null);
  });

  it('enforces text and file bounds deterministically', () => {
    const dto = commitDto({
      messageHeadline: 'h'.repeat(150),
      messageFull: 'm'.repeat(600),
      files: Array.from({ length: 60 }, (_, i) => `f${i}.js`),
    });
    const before = JSON.stringify(dto);
    const a = normalizeCommit(dto, { userId: USER_ID, repoIdMap: MAP });
    assert.equal(a.messageHeadline.length, 120);
    assert.equal(a.messageFull.length, 500);
    assert.equal(a.files.length, 50);
    assert.deepEqual(a, normalizeCommit(dto, { userId: USER_ID, repoIdMap: MAP }));
    assert.equal(JSON.stringify(dto), before, 'input DTO must be untouched');
  });

  it('accepts exact-boundary values as-is', () => {
    const doc = normalizeCommit(
      commitDto({
        messageHeadline: 'h'.repeat(120),
        files: Array.from({ length: 50 }, (_, i) => `f${i}.js`),
      }),
      { userId: USER_ID, repoIdMap: MAP }
    );
    assert.equal(doc.messageHeadline.length, 120);
    assert.equal(doc.files.length, 50);
  });

  it('rejects missing provenance', () => {
    const noProv = { ...commitDto() };
    delete noProv.fetchedAt;
    assert.throws(
      () => normalizeCommit(noProv, { userId: USER_ID, repoIdMap: MAP }),
      (e) => e.code === 'VALIDATION_ERROR'
    );
  });

  it('normalizes concurrently without shared state', async () => {
    const dto = commitDto();
    const results = await Promise.all([
      normalizeCommit(dto, { userId: USER_ID, repoIdMap: MAP }),
      normalizeCommit(dto, { userId: USER_ID, repoIdMap: MAP }),
    ]);
    assert.deepEqual(results[0], results[1]);
  });
});
