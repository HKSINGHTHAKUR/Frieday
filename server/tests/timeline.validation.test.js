/**
 * Timeline query validation (F3 regression): malformed repoId must be
 * rejected by the query schema (→ 400 VALIDATION_ERROR envelope via the
 * validate() middleware) instead of reaching ObjectId conversion, which
 * surfaced as a 500.
 *
 * DB-free: the schema is pure (validation.js).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { timelineQuerySchema } = require('../src/utils/validation');

describe('timelineQuerySchema repoId validation (F3 regression)', () => {
  it('1: rejects repoId=not-an-object-id', () => {
    const result = timelineQuerySchema.safeParse({ range: '30d', repoId: 'not-an-object-id' });
    assert.equal(result.success, false);
    assert.ok(result.error.flatten().fieldErrors.repoId);
  });

  it('2: rejects another malformed repoId (short garbage)', () => {
    const result = timelineQuerySchema.safeParse({ range: '30d', repoId: 'abc' });
    assert.equal(result.success, false);
    assert.ok(result.error.flatten().fieldErrors.repoId);
  });

  it('2b: rejects a 50-character invalid repoId value', () => {
    const result = timelineQuerySchema.safeParse({
      range: '30d',
      repoId: '50-char-invalid-value-xxxxxxxxxxxxxxxxxxx',
    });
    assert.equal(result.success, false);
    assert.ok(result.error.flatten().fieldErrors.repoId);
  });

  it('accepts a valid 24-character hex repoId', () => {
    const result = timelineQuerySchema.safeParse({
      range: '30d',
      repoId: '64b64b64b64b64b64b64b64b',
    });
    assert.equal(result.success, true);
    assert.equal(result.data.repoId, '64b64b64b64b64b64b64b64b');
  });

  it('accepts uppercase hex ObjectIds (BSON accepts them)', () => {
    const result = timelineQuerySchema.safeParse({
      range: '30d',
      repoId: '64B64B64B64B64B64B64B64B',
    });
    assert.equal(result.success, true);
  });

  it('repoId remains optional (no repoId still validates)', () => {
    const result = timelineQuerySchema.safeParse({ range: '90d' });
    assert.equal(result.success, true);
  });
});
