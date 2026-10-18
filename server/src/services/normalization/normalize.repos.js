/**
 * Repository normalizer (T3.2) — T2.2 repository DTO → Repository document.
 *
 * Pure and deterministic: the same DTO yields the same document, and the
 * input DTO is never mutated. Truncation re-applies the documented bounds
 * (idempotent: truncating an already-truncated value is a no-op).
 */
const {
  truncate,
  validationError,
  asIdentityInt,
  asIdentityString,
  asDate,
  checkEnum,
  asCount,
  asText,
} = require('./normalize.common');

const VISIBILITY = ['public', 'private', 'internal'];
const SOURCES = ['rest', 'webhook'];

function normalizeRepository(dto, ctx = {}) {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
    throw validationError('repository', 'Malformed repository DTO.', {});
  }
  const { userId } = ctx;
  if (userId === undefined || userId === null) {
    throw validationError('repository', 'Missing user scope.', {});
  }
  const githubId = asIdentityInt(dto.githubId, 'githubId', 'repository', { githubId: dto.githubId });
  const identity = { githubId };
  return {
    userId,
    githubId,
    owner: asIdentityString(dto.owner, 'owner', 'repository', identity),
    name: asIdentityString(dto.name, 'name', 'repository', identity),
    fullName: asIdentityString(dto.fullName, 'fullName', 'repository', identity),
    visibility: checkEnum(dto.visibility, VISIBILITY, 'visibility', 'repository', identity),
    primaryLanguage: asText(dto.primaryLanguage),
    stars: asCount(dto.stars, 0),
    fork: Boolean(dto.fork),
    defaultBranch: asText(dto.defaultBranch),
    githubUpdatedAt: asDate(dto.githubUpdatedAt, {
      field: 'githubUpdatedAt',
      resource: 'repository',
      identity,
      required: false,
    }),
    pushedAt: asDate(dto.pushedAt, { field: 'pushedAt', resource: 'repository', identity, required: false }),
    archived: Boolean(dto.archived),
    disabled: Boolean(dto.disabled),
    description: truncate(asText(dto.description) ?? '', 500) || null,
    htmlUrl: asText(dto.htmlUrl),
    cloneUrl: asText(dto.cloneUrl),
    sshUrl: asText(dto.sshUrl),
    homepage: asText(dto.homepage),
    topics: Array.isArray(dto.topics) ? dto.topics.filter((t) => typeof t === 'string') : [],
    license:
      dto.license && typeof dto.license === 'object'
        ? {
            key: asText(dto.license.key),
            name: asText(dto.license.name),
            spdxId: asText(dto.license.spdxId),
          }
        : null,
    lastSyncedAt: null,
    fetchedAt: asDate(dto.fetchedAt, {
      field: 'fetchedAt',
      resource: 'repository',
      identity,
      required: true,
    }),
    source: checkEnum(dto.source, SOURCES, 'source', 'repository', identity),
  };
}

module.exports = { normalizeRepository, VISIBILITY, SOURCES };
