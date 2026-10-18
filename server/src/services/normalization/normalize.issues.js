/**
 * Issue normalizer (T3.2) — T2.2 issue DTO → Issue document.
 *
 * Pure and deterministic: the same DTO yields the same document, and the
 * input DTO is never mutated. The ownership flag (`isAuthoredByUser`) is
 * computed here against the syncing user's login — never trusted from
 * outside. Title bound ≤200ch and body ≤500ch mirror the documented
 * contract. Labels keep the DTO shape ({ name, color, description }).
 */
const {
  truncate,
  validationError,
  asIdentityInt,
  asDate,
  checkEnum,
  asCount,
  asText,
  resolveRepoId,
} = require('./normalize.common');

const STATES = ['open', 'closed'];
const SOURCES = ['rest', 'webhook'];

function normalizeUser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    login: typeof value.login === 'string' ? value.login : null,
    id: typeof value.id === 'number' ? value.id : null,
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
  };
}

function normalizeLabel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    name: typeof value.name === 'string' ? value.name : null,
    color: typeof value.color === 'string' ? value.color : null,
    description: typeof value.description === 'string' ? value.description : null,
  };
}

function normalizeMilestone(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let dueOn = null;
  if (value.dueOn !== undefined && value.dueOn !== null && value.dueOn !== '') {
    const parsed = value.dueOn instanceof Date ? value.dueOn : new Date(value.dueOn);
    if (!Number.isNaN(parsed.getTime())) dueOn = parsed;
  }
  return {
    number: typeof value.number === 'number' ? value.number : null,
    title: typeof value.title === 'string' ? value.title : null,
    state: typeof value.state === 'string' ? value.state : null,
    dueOn,
  };
}

function normalizeIssue(dto, ctx = {}) {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
    throw validationError('issue', 'Malformed issue DTO.', {});
  }
  const { userId, userLogin } = ctx;
  if (userId === undefined || userId === null) {
    throw validationError('issue', 'Missing user scope.', {});
  }
  const number = asIdentityInt(dto.number, 'number', 'issue', { number: dto.number });
  const identity = { number };
  const titleText = asText(dto.title);
  if (!titleText) {
    throw validationError('issue', 'Missing required field: title.', { resource: 'issue', identity });
  }
  const author = normalizeUser(dto.author);
  return {
    userId,
    repoId: resolveRepoId(ctx.repoIdMap, dto.repoId, 'issue'),
    number,
    state: checkEnum(dto.state, STATES, 'state', 'issue', identity),
    title: truncate(titleText, 200),
    body: truncate(asText(dto.body) ?? '', 500) || null,
    createdAt: asDate(dto.createdAt, { field: 'createdAt', resource: 'issue', identity, required: true }),
    updatedAt: asDate(dto.updatedAt, { field: 'updatedAt', resource: 'issue', identity, required: false }),
    closedAt: asDate(dto.closedAt, { field: 'closedAt', resource: 'issue', identity, required: false }),
    author,
    authorLogin: author && typeof author.login === 'string' ? author.login : null,
    isAuthoredByUser: Boolean(userLogin && author && author.login === userLogin),
    authorAssociation: asText(dto.authorAssociation),
    assignees: Array.isArray(dto.assignees) ? dto.assignees.map(normalizeUser).filter(Boolean) : [],
    labels: Array.isArray(dto.labels) ? dto.labels.map(normalizeLabel).filter(Boolean) : [],
    comments: asCount(dto.comments, 0),
    locked: Boolean(dto.locked),
    milestone: normalizeMilestone(dto.milestone),
    lastSyncedAt: null,
    fetchedAt: asDate(dto.fetchedAt, { field: 'fetchedAt', resource: 'issue', identity, required: true }),
    source: checkEnum(dto.source, SOURCES, 'source', 'issue', identity),
  };
}

module.exports = { normalizeIssue, STATES, SOURCES };
