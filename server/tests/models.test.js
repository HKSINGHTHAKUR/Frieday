/**
 * Phase 3 raw + derived model tests (tasks.md T3.1).
 *
 * Schema-level validation (required fields, enums, truncation bounds,
 * defaults, declared indexes) runs with NO database. Mongo-dependent
 * behavior (unique-identity dedupe, cross-user scoping, provenance) follows
 * the established DB-gated pattern: skip with an explicit reason when
 * MongoDB is unavailable.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Repository = require('../src/models/Repository');
const Commit = require('../src/models/Commit');
const PullRequest = require('../src/models/PullRequest');
const Issue = require('../src/models/Issue');
const LanguageSnapshot = require('../src/models/LanguageSnapshot');
const ActivityBucket = require('../src/models/ActivityBucket');
const Insight = require('../src/models/Insight');

const oid = () => new mongoose.Types.ObjectId();
const PROVENANCE = { fetchedAt: new Date(), source: 'rest' };

function validRepo(overrides = {}) {
  return {
    userId: oid(),
    githubId: 42,
    owner: 'octo',
    name: 'demo',
    fullName: 'octo/demo',
    visibility: 'public',
    ...PROVENANCE,
    ...overrides,
  };
}

function validCommit(overrides = {}) {
  return {
    userId: oid(),
    sha: 'abc123',
    repoId: oid(),
    authoredAt: new Date(),
    ...PROVENANCE,
    ...overrides,
  };
}

function validPull(overrides = {}) {
  return {
    userId: oid(),
    repoId: oid(),
    number: 7,
    state: 'open',
    title: 'Add feature',
    createdAt: new Date(),
    ...PROVENANCE,
    ...overrides,
  };
}

function validIssue(overrides = {}) {
  return {
    userId: oid(),
    repoId: oid(),
    number: 9,
    state: 'open',
    title: 'Bug report',
    createdAt: new Date(),
    ...PROVENANCE,
    ...overrides,
  };
}

function indexExists(model, fields, opts = {}) {
  return model.schema
    .indexes()
    .some(
      ([indexed, options]) =>
        Object.entries(fields).every(([k, v]) => indexed[k] === v) &&
        Object.entries(opts).every(([k, v]) => options[k] === v)
    );
}

describe('T3.1 models (schema level, no DB)', () => {
  describe('Repository', () => {
    it('requires identity + visibility + provenance', async () => {
      await assert.rejects(new Repository({ ...validRepo(), userId: undefined }).validate());
      await assert.rejects(new Repository({ ...validRepo(), githubId: undefined }).validate());
      await assert.rejects(new Repository({ ...validRepo(), visibility: 'bogus' }).validate());
      await assert.rejects(new Repository({ ...validRepo(), fetchedAt: undefined }).validate());
      await assert.rejects(new Repository({ ...validRepo(), source: 'carrier-pigeon' }).validate());
    });

    it('applies sane defaults and accepts the full DTO shape', async () => {
      const doc = new Repository({
        ...validRepo(),
        visibility: 'private',
        description: 'a'.repeat(600).slice(0, 500),
        topics: ['a', 'b'],
        license: { key: 'mit', name: 'MIT', spdxId: 'MIT' },
      });
      await doc.validate();
      assert.equal(doc.stars, 0);
      assert.equal(doc.fork, false);
      assert.deepEqual(doc.topics, ['a', 'b']);
      assert.equal(doc.license.key, 'mit');
    });

    it('declares the unique (userId, githubId) upsert identity', () => {
      assert.ok(
        indexExists(Repository, { userId: 1, githubId: 1 }, { unique: true }),
        'upsert index missing'
      );
    });
  });

  describe('Commit', () => {
    it('requires identity + author date + provenance', async () => {
      await assert.rejects(new Commit({ ...validCommit(), sha: undefined }).validate());
      await assert.rejects(new Commit({ ...validCommit(), repoId: undefined }).validate());
      await assert.rejects(new Commit({ ...validCommit(), authoredAt: undefined }).validate());
      await assert.rejects(new Commit({ ...validCommit(), fetchedAt: undefined }).validate());
    });

    it('enforces the truncation bounds (headline 120, message 500, files 50)', async () => {
      await assert.rejects(new Commit({ ...validCommit(), messageHeadline: 'a'.repeat(121) }).validate());
      await assert.rejects(new Commit({ ...validCommit(), messageFull: 'a'.repeat(501) }).validate());
      await assert.rejects(
        new Commit({ ...validCommit(), files: Array.from({ length: 51 }, (_, i) => `f${i}.js`) }).validate()
      );
      await new Commit({
        ...validCommit(),
        messageHeadline: 'a'.repeat(120),
        files: Array.from({ length: 50 }, (_, i) => `f${i}.js`),
      }).validate();
    });

    it('accepts missing authors (commits without a GitHub user)', async () => {
      await new Commit({ ...validCommit(), author: null, committer: null }).validate();
    });

    it('declares upsert identity + timeline sort index', () => {
      assert.ok(
        indexExists(Commit, { userId: 1, sha: 1, repoId: 1 }, { unique: true }),
        'upsert index missing'
      );
      assert.ok(indexExists(Commit, { userId: 1, authoredAt: -1 }), 'timeline sort index missing');
    });
  });

  describe('PullRequest', () => {
    it('requires identity + state + title + createdAt + provenance', async () => {
      await assert.rejects(new PullRequest({ ...validPull(), number: undefined }).validate());
      await assert.rejects(new PullRequest({ ...validPull(), state: 'bogus' }).validate());
      await assert.rejects(new PullRequest({ ...validPull(), title: 'a'.repeat(201) }).validate());
      await assert.rejects(new PullRequest({ ...validPull(), createdAt: undefined }).validate());
      await assert.rejects(new PullRequest({ ...validPull(), fetchedAt: undefined }).validate());
    });

    it('accepts ownership flags, reviewers and merged state', async () => {
      const doc = new PullRequest({
        ...validPull(),
        state: 'closed',
        merged: true,
        mergedAt: new Date(),
        authorLogin: 'octo',
        isAuthoredByUser: true,
        reviewers: [{ login: 'rev', id: 5 }],
      });
      await doc.validate();
      assert.equal(doc.reviewers.length, 1);
    });

    it('declares the unique (userId, repoId, number) upsert identity', () => {
      assert.ok(
        indexExists(PullRequest, { userId: 1, repoId: 1, number: 1 }, { unique: true }),
        'upsert index missing'
      );
    });
  });

  describe('Issue', () => {
    it('requires identity + state + title + createdAt + provenance', async () => {
      await assert.rejects(new Issue({ ...validIssue(), number: undefined }).validate());
      await assert.rejects(new Issue({ ...validIssue(), state: 'bogus' }).validate());
      await assert.rejects(new Issue({ ...validIssue(), title: 'a'.repeat(201) }).validate());
      await assert.rejects(new Issue({ ...validIssue(), createdAt: undefined }).validate());
    });

    it('accepts labels, assignees and milestones', async () => {
      const doc = new Issue({
        ...validIssue(),
        labels: [{ name: 'bug', color: 'red', description: 'Broken' }],
        assignees: [{ login: 'octo', id: 1 }],
        milestone: { number: 3, title: 'v1', state: 'open', dueOn: new Date() },
      });
      await doc.validate();
      assert.equal(doc.labels[0].name, 'bug');
      assert.equal(doc.milestone.number, 3);
    });

    it('declares the unique (userId, repoId, number) upsert identity', () => {
      assert.ok(
        indexExists(Issue, { userId: 1, repoId: 1, number: 1 }, { unique: true }),
        'upsert index missing'
      );
    });
  });

  describe('LanguageSnapshot', () => {
    it('requires repo + observation time and stores a byte map', async () => {
      await assert.rejects(new LanguageSnapshot({ userId: oid(), repoId: oid(), source: 'rest' }).validate());
      const doc = new LanguageSnapshot({
        userId: oid(),
        repoId: oid(),
        fetchedAt: new Date(),
        bytes: { JavaScript: 9000 },
        source: 'rest',
      });
      await doc.validate();
      assert.equal(doc.bytes.get('JavaScript'), 9000);
    });

    it('declares the unique (userId, repoId, fetchedAt) observation identity', () => {
      assert.ok(
        indexExists(LanguageSnapshot, { userId: 1, repoId: 1, fetchedAt: 1 }, { unique: true }),
        'observation index missing'
      );
    });
  });

  describe('ActivityBucket', () => {
    it('requires range + granularity + bucket start and validates the range allowlist', async () => {
      await assert.rejects(
        new ActivityBucket({
          userId: oid(),
          range: 'bogus',
          granularity: 'day',
          bucketStart: new Date(),
        }).validate()
      );
      await assert.rejects(
        new ActivityBucket({ userId: oid(), range: '30d', granularity: 'day' }).validate()
      );
      await assert.rejects(
        new ActivityBucket({
          userId: oid(),
          range: '30d',
          granularity: 'day',
          bucketStart: new Date(),
          commits: -1,
        }).validate()
      );
      await assert.rejects(
        new ActivityBucket({ userId: oid(), range: '30d', bucketStart: new Date() }).validate(),
        'granularity is required'
      );
      const agg = new ActivityBucket({
        userId: oid(),
        range: '90d',
        granularity: 'week',
        bucketStart: new Date(),
        commits: 4,
      });
      await agg.validate();
      assert.equal(agg.repoId, null);
    });

    it('declares the unique bucket identity (aggregate + per-repo, granularity-scoped)', () => {
      assert.ok(
        indexExists(
          ActivityBucket,
          { userId: 1, range: 1, granularity: 1, bucketStart: 1, repoId: 1 },
          { unique: true }
        ),
        'bucket index missing'
      );
    });
  });

  describe('Insight', () => {
    it('requires range + template + generation time + text + confidence', async () => {
      const base = {
        userId: oid(),
        range: '30d',
        templateId: 't1',
        generatedAt: new Date(),
        title: 'T',
        text: 'X',
        confidence: 'High',
      };
      await new Insight(base).validate();
      await assert.rejects(new Insight({ ...base, range: 'bogus' }).validate());
      await assert.rejects(new Insight({ ...base, confidence: 'Expert' }).validate());
      await assert.rejects(new Insight({ ...base, text: 'a'.repeat(2001) }).validate());
    });

    it('accepts metrics Mixed plus evidence references', async () => {
      const repoId = oid();
      const doc = new Insight({
        userId: oid(),
        range: '90d',
        templateId: 't2',
        generatedAt: new Date(),
        title: 'T',
        text: 'X',
        metrics: { deltaPct: 42, nested: { ok: true } },
        evidence: { repoIds: [repoId], commitShas: ['abc'], prNumbers: [7], bucketStarts: [new Date()] },
        confidence: 'Medium',
      });
      await doc.validate();
      assert.equal(doc.metrics.deltaPct, 42);
      assert.equal(String(doc.evidence.repoIds[0]), String(repoId));
    });

    it('declares the unique identity per (userId, range, templateId)', () => {
      assert.ok(
        indexExists(Insight, { userId: 1, range: 1, templateId: 1 }, { unique: true }),
        'unique index on (userId, range, templateId) missing'
      );
    });
  });
});
