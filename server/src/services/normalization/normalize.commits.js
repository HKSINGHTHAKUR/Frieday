/**
 * Commit normalizer (T3.2) — T2.2 commit DTO → Commit document.
 *
 * Pure and deterministic: the same DTO yields the same document, and the
 * input DTO is never mutated. Truncation re-applies the documented bounds
 * (headline ≤120ch, message ≤500ch, files ≤50 paths); identity fields
 * (sha) are validated but never truncated or transformed.
 */
const {
  truncate,
  validationError,
  asIdentityString,
  asDate,
  checkEnum,
  asCount,
  asText,
  resolveRepoId,
} = require('./normalize.common');

const SOURCES = ['rest', 'webhook'];
const MAX_FILES = 50;

function normalizeUser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    login: typeof value.login === 'string' ? value.login : null,
    id: typeof value.id === 'number' ? value.id : null,
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
  };
}

function normalizeCommit(dto, ctx = {}) {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
    throw validationError('commit', 'Malformed commit DTO.', {});
  }
  const { userId } = ctx;
  if (userId === undefined || userId === null) {
    throw validationError('commit', 'Missing user scope.', {});
  }
  const sha = asIdentityString(dto.sha, 'sha', 'commit', { sha: dto.sha });
  const identity = { sha };
  return {
    userId,
    sha,
    repoId: resolveRepoId(ctx.repoIdMap, dto.repoId, 'commit'),
    messageHeadline: truncate(asText(dto.messageHeadline) ?? '', 120) || null,
    messageFull: truncate(asText(dto.messageFull) ?? '', 500) || null,
    authoredAt: asDate(dto.authoredAt, { field: 'authoredAt', resource: 'commit', identity, required: true }),
    committedAt: asDate(dto.committedAt, {
      field: 'committedAt',
      resource: 'commit',
      identity,
      required: false,
    }),
    author: normalizeUser(dto.author),
    committer: normalizeUser(dto.committer),
    additions: asCount(dto.additions, 0),
    deletions: asCount(dto.deletions, 0),
    total: asCount(dto.total, 0),
    files: Array.isArray(dto.files) ? dto.files.filter((f) => typeof f === 'string').slice(0, MAX_FILES) : [],
    parents: Array.isArray(dto.parents) ? dto.parents.filter((p) => typeof p === 'string') : [],
    lastSyncedAt: null,
    fetchedAt: asDate(dto.fetchedAt, { field: 'fetchedAt', resource: 'commit', identity, required: true }),
    source: checkEnum(dto.source, SOURCES, 'source', 'commit', identity),
  };
}

module.exports = { normalizeCommit, SOURCES, MAX_FILES };
