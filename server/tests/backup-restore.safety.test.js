/**
 * Backup/restore safety guard tests (Item 1, Phase 9).
 *
 * These tests exercise the URI validation, credential redaction, and
 * production-refusal guards without needing a live MongoDB instance.
 * Integration tests that require a real database are in
 * backup-restore.integration.test.js and skip when MongoDB is unavailable.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { URL } = require('node:url');

// Identical guards to scripts/backup-restore.js (kept in sync manually).
const PRODUCTION_DB_PATTERNS = [/frieday_prod/i, /production/i, /prod/i];
const ATLAS_URI_PATTERN = /^mongodb\+srv:\/\//i;

function redactUri(uri) {
  if (!uri || typeof uri !== 'string') return '<not-set>';
  return uri.replace(/:[^:@]+@/, ':***@');
}

function isProductionDbName(name) {
  if (!name) return false;
  return PRODUCTION_DB_PATTERNS.some((p) => p.test(name));
}

function isAtlasUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  return ATLAS_URI_PATTERN.test(uri);
}

function validateUri(uri, label) {
  const problems = [];
  if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
    problems.push(`${label}: URI is empty`);
  } else {
    try {
      new URL(uri);
    } catch {
      problems.push(`${label}: not a parseable URI`);
    }
    if (isAtlasUri(uri)) {
      problems.push(
        `${label}: Atlas (mongodb+srv://) URIs are not supported by this script — use mongodump/mongorestore from the Atlas console instead`
      );
    }
    if (isProductionDbName(uri)) {
      problems.push(`${label}: URI targets a production-looking database name`);
    }
  }
  return problems;
}

function validateTargetDb(dbName, label, sourceDbName) {
  const problems = [];
  if (!dbName || typeof dbName !== 'string' || dbName.trim().length === 0) {
    problems.push(`${label}: target database name is empty`);
    return problems;
  }
  if (isProductionDbName(dbName)) {
    problems.push(
      `${label}: "${dbName}" looks like a production database — restore targets must be disposable/temp databases`
    );
  }
  if (sourceDbName && dbName === sourceDbName) {
    problems.push(
      `${label}: target database "${dbName}" is the same as the source — restore must target a separate database`
    );
  }
  return problems;
}

describe('backup-restore: credential redaction (Item 1)', () => {
  it('redacts the password portion of a MongoDB URI', () => {
    const uri = 'mongodb+srv://user:secret-pass@cluster.mongodb.net/frieday?retryWrites=true';
    const redacted = redactUri(uri);
    assert.ok(!redacted.includes('secret-pass'), 'password must not appear in redacted URI');
    assert.ok(redacted.includes(':***@'), 'redacted URI must contain the mask');
    assert.ok(redacted.includes('cluster.mongodb.net'), 'hostname must remain visible');
  });

  it('redacts a standard mongodb:// URI with credentials', () => {
    const uri = 'mongodb://admin:topsecret@db.example.com:27017/frieday';
    const redacted = redactUri(uri);
    assert.ok(!redacted.includes('topsecret'), 'password must not appear in redacted URI');
    assert.ok(redacted.includes(':***@'), 'redacted URI must contain the mask');
  });

  it('handles URIs without credentials', () => {
    const uri = 'mongodb://127.0.0.1:27017/frieday_test';
    const redacted = redactUri(uri);
    assert.equal(redacted, uri, 'URI without credentials must pass through unchanged');
  });

  it('handles null/empty URIs safely', () => {
    assert.equal(redactUri(null), '<not-set>');
    assert.equal(redactUri(undefined), '<not-set>');
    assert.equal(redactUri(''), '<not-set>');
  });

  it('never logs the secret in validateUri output', () => {
    const uri = 'mongodb+srv://user:super-secret@cluster0.abc123.mongodb.net/frieday_prod';
    const problems = validateUri(uri, 'source');
    const allText = problems.join(' ');
    assert.ok(!allText.includes('super-secret'), 'secret must not appear in validation errors');
  });
});

describe('backup-restore: production database refusal (Item 1)', () => {
  it('refuses Atlas (mongodb+srv://) URIs', () => {
    const problems = validateUri('mongodb+srv://user:pass@cluster.mongodb.net/frieday', 'source');
    assert.ok(
      problems.some((p) => p.includes('Atlas')),
      'Atlas URIs must be refused'
    );
  });

  it('refuses production-looking database names in URI', () => {
    const problems = validateUri('mongodb://127.0.0.1:27017/frieday_prod', 'source');
    assert.ok(
      problems.some((p) => p.includes('production-looking')),
      'production DB names must be refused'
    );
  });

  it('refuses "production" database name', () => {
    const problems = validateUri('mongodb://127.0.0.1:27017/production', 'source');
    assert.ok(
      problems.some((p) => p.includes('production-looking')),
      '"production" DB name must be refused'
    );
  });

  it('refuses "prod" database name', () => {
    const problems = validateUri('mongodb://127.0.0.1:27017/prod', 'source');
    assert.ok(
      problems.some((p) => p.includes('production-looking')),
      '"prod" DB name must be refused'
    );
  });

  it('allows local test databases', () => {
    const problems = validateUri('mongodb://127.0.0.1:27017/frieday_test_configdb', 'source');
    assert.equal(problems.length, 0, 'local test DB must be allowed: ' + JSON.stringify(problems));
  });

  it('allows development database', () => {
    const problems = validateUri('mongodb://127.0.0.1:27017/frieday', 'source');
    assert.equal(problems.length, 0, 'development DB must be allowed: ' + JSON.stringify(problems));
  });

  it('refuses production target database names', () => {
    const problems = validateTargetDb('frieday_prod', 'target', null);
    assert.ok(
      problems.some((p) => p.includes('production database')),
      'production target must be refused'
    );
  });

  it('refuses target same as source', () => {
    const problems = validateTargetDb('frieday_test', 'target', 'frieday_test');
    assert.ok(
      problems.some((p) => p.includes('same as the source')),
      'target == source must be refused'
    );
  });

  it('allows distinct disposable target databases', () => {
    const problems = validateTargetDb('frieday_restore_temp', 'target', 'frieday_test');
    assert.equal(problems.length, 0, 'distinct temp target must be allowed: ' + JSON.stringify(problems));
  });

  it('refuses empty target database name', () => {
    const problems = validateTargetDb('', 'target', null);
    assert.ok(
      problems.some((p) => p.includes('empty')),
      'empty target must be refused'
    );
  });
});

describe('backup-restore: URI parsing validation (Item 1)', () => {
  it('accepts valid MongoDB URIs', () => {
    assert.equal(validateUri('mongodb://127.0.0.1:27017/frieday_test', 'source').length, 0);
    assert.equal(
      validateUri('mongodb://user:pass@localhost:27017/frieday?authSource=admin', 'source').length,
      0
    );
  });

  it('rejects empty URIs', () => {
    assert.ok(validateUri(null, 'source').length > 0);
    assert.ok(validateUri('', 'source').length > 0);
    assert.ok(validateUri(undefined, 'source').length > 0);
  });

  it('rejects unparseable URIs', () => {
    const problems = validateUri('not-a-uri', 'source');
    assert.ok(
      problems.some((p) => p.includes('parseable')),
      'unparseable URI must be rejected'
    );
  });
});
