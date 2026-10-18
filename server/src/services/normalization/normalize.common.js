/**
 * Shared normalization primitives (T3.2).
 *
 * T2.2 fetcher DTOs are treated as untrusted external data at this boundary:
 * every required identity field, enum, timestamp, and provenance value is
 * validated, and anything else fails the record with a typed
 * ValidationError (never a silent skip, never fabricated data).
 *
 * `truncate` is imported from the GitHub fetcher utilities (single
 * cross-layer seam, documented here) so the T3.2 bounds behave EXACTLY like
 * the T2.2 DTO bounds — sharing the implementation prevents drift. No other
 * GitHub-layer dependency exists in normalization (no network, no Octokit).
 */
const { truncate } = require('../github/fetcherUtils');

function validationError(resource, message, details) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.retryable = false;
  err.details = details;
  return err;
}

/** Require a present identity value (identity fields are never truncated). */
function needIdentity(value, field, resource, identity) {
  if (value === undefined || value === null || value === '') {
    throw validationError(resource, `Missing required identity field: ${field}.`, { resource, identity });
  }
  return value;
}

/** Integer GitHub identity (repository/issue/PR numbers and IDs). */
function asIdentityInt(value, field, resource, identity) {
  needIdentity(value, field, resource, identity);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw validationError(resource, `Invalid identity field: ${field}.`, { resource, identity });
  }
  return n;
}

/** Non-empty identity string (SHAs, names, logins). Never trimmed or cased. */
function asIdentityString(value, field, resource, identity) {
  needIdentity(value, field, resource, identity);
  if (typeof value !== 'string' || value.length === 0) {
    throw validationError(resource, `Invalid identity field: ${field}.`, { resource, identity });
  }
  return value;
}

/**
 * Coerce a source timestamp to a Date. Required timestamps reject invalid
 * input (a sort key must never silently become null); optional ones fall
 * back to null. Accepts Date instances (the T2.2 DTO contract) plus numeric
 * or parseable-string defensiveness. Never substitutes "now".
 */
function asDate(value, { field, resource, identity, required }) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw validationError(resource, `Missing required timestamp: ${field}.`, { resource, identity });
    }
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (required) {
      throw validationError(resource, `Invalid timestamp: ${field}.`, { resource, identity });
    }
    return null;
  }
  return date;
}

/** Strict enum membership (unknown values reject — never invent a mapping). */
function checkEnum(value, allowed, field, resource, identity) {
  if (!allowed.includes(value)) {
    throw validationError(resource, `Invalid value for ${field}.`, { resource, identity });
  }
  return value;
}

/**
 * Lenient measurement coercion for counts (stars, additions, ...): finite
 * numbers floor at zero, anything else falls back to the default. Counts can
 * never break identity or ordering, so coercion (not rejection) is safe.
 */
function asCount(value, def = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.trunc(n));
}

/** Optional free text (null stays null; never becomes "null"/"undefined"). */
function asText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  return value;
}

/**
 * Resolve a DTO repository reference (String GitHub id, per the T2.3
 * convention) to the Mongo ObjectId via a preloaded map. Unknown or
 * malformed references reject — never invent a foreign key.
 */
function resolveRepoId(repoIdMap, rawGithubId, resource) {
  const githubId = typeof rawGithubId === 'number' ? rawGithubId : Number(rawGithubId);
  if (!Number.isInteger(githubId) || githubId <= 0) {
    throw validationError(resource, 'Invalid repository reference.', { resource });
  }
  const resolved = repoIdMap ? repoIdMap.get(githubId) : undefined;
  if (!resolved) {
    throw validationError(resource, 'Unknown repository reference.', { resource, githubId });
  }
  return resolved;
}

module.exports = {
  truncate,
  validationError,
  needIdentity,
  asIdentityInt,
  asIdentityString,
  asDate,
  checkEnum,
  asCount,
  asText,
  resolveRepoId,
};
