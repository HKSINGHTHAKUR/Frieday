/**
 * Language normalizer (T3.2) — T2.2 language DTO → LanguageSnapshot document.
 *
 * Pure and deterministic: the same DTO yields the same document, and the
 * input DTO is never mutated. Converts the DTO's `[{ language, bytes }]`
 * array into the schema's `bytes` map (architecture.md §6); non-numeric
 * byte counts become 0 rather than failing the row.
 */
const { validationError, asDate, checkEnum, resolveRepoId } = require('./normalize.common');

const SOURCES = ['rest', 'webhook'];

function normalizeLanguages(dto, ctx = {}) {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
    throw validationError('languages', 'Malformed languages DTO.', {});
  }
  const { userId } = ctx;
  if (userId === undefined || userId === null) {
    throw validationError('languages', 'Missing user scope.', {});
  }
  const bytes = {};
  if (Array.isArray(dto.languages)) {
    for (const entry of dto.languages) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (typeof entry.language !== 'string' || entry.language.length === 0) continue;
      const count =
        typeof entry.bytes === 'number' && Number.isFinite(entry.bytes)
          ? Math.max(0, Math.trunc(entry.bytes))
          : 0;
      bytes[entry.language] = count;
    }
  }
  const identity = { repoId: dto.repoId };
  return {
    userId,
    repoId: resolveRepoId(ctx.repoIdMap, dto.repoId, 'languages'),
    fetchedAt: asDate(dto.fetchedAt, { field: 'fetchedAt', resource: 'languages', identity, required: true }),
    bytes,
    source: checkEnum(dto.source, SOURCES, 'source', 'languages', identity),
  };
}

module.exports = { normalizeLanguages, SOURCES };
