/**
 * SyncJob T2.3 field/index tests (additive — T2.1 fields are covered in
 * syncModels.test.js and must keep passing unchanged).
 *
 * Schema-level only (no database): the partial unique index is verified by
 * declaration like the existing index tests; duplicate-key enforcement
 * itself is MongoDB's job and is exercised through the fake store's
 * E11000 mirror in the service tests.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const SyncJob = require('../src/models/SyncJob');

describe('SyncJob T2.3 additions (schema level, no DB)', () => {
  it('accepts counts, errorCode and resumeAt', async () => {
    const resumeAt = new Date(Date.now() + 3600000);
    await new SyncJob({
      userId: new mongoose.Types.ObjectId(),
      kind: 'resync',
      status: 'failed',
      perResource: { repositories: 'done', commits: 'rate_limited' },
      counts: { repositories: 2, commits: 4 },
      error: 'GitHub rate limit reached.',
      errorCode: 'RATE_LIMITED',
      resumeAt,
      startedAt: new Date(),
      finishedAt: new Date(),
    }).validate();
  });

  it('leaves the new fields empty by default', async () => {
    const job = new SyncJob({ userId: new mongoose.Types.ObjectId(), kind: 'initial' });
    await job.validate();
    assert.equal(job.counts, null);
    assert.equal(job.errorCode, null);
    assert.equal(job.resumeAt, null);
  });

  it('declares the single-flight partial unique index on active jobs', () => {
    const indexes = SyncJob.schema.indexes();
    const found = indexes.find(
      ([fields, opts]) => fields.userId === 1 && opts.unique === true && opts.partialFilterExpression
    );
    assert.ok(found, `single-flight index missing: ${JSON.stringify(indexes)}`);
    const statuses = found[1].partialFilterExpression.status.$in;
    assert.ok(
      statuses.includes('queued') && statuses.includes('running'),
      'index must cover queued + running only'
    );
    assert.ok(
      !statuses.includes('succeeded') && !statuses.includes('failed'),
      'terminal jobs must not be constrained'
    );
  });

  it('keeps the T2.1 history index alongside the new one', () => {
    const indexes = SyncJob.schema.indexes();
    assert.ok(
      indexes.some(([fields]) => fields.userId === 1 && fields.createdAt === -1),
      'history index must be unaffected'
    );
  });
});
