/**
 * Pull-request normalizer (T3.2) — T2.2 PR DTO → PullRequest document.
 *
 * Pure and deterministic: the same DTO yields the same document, and the
 * input DTO is never mutated. Ownership flags (`isAuthoredByUser`,
 * `isReviewedByUser`) are computed here from the stored author/reviewers
 * against the syncing user's login — never trusted from outside. Title
 * bound ≤200ch and body ≤500ch mirror the documented contract.
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

function normalizeSlimRepo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    id: typeof value.id === 'number' ? value.id : null,
    fullName: typeof value.fullName === 'string' ? value.fullName : null,
  };
}

function normalizeUserList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeUser).filter(Boolean);
}

function normalizePullRequest(dto, ctx = {}) {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
    throw validationError('pull', 'Malformed pull-request DTO.', {});
  }
  const { userId, userLogin } = ctx;
  if (userId === undefined || userId === null) {
    throw validationError('pull', 'Missing user scope.', {});
  }
  const number = asIdentityInt(dto.number, 'number', 'pull', { number: dto.number });
  const identity = { number };
  const titleText = asText(dto.title);
  if (!titleText) {
    throw validationError('pull', 'Missing required field: title.', { resource: 'pull', identity });
  }
  const author = normalizeUser(dto.author);
  const reviewers = normalizeUserList(dto.reviewers);
  const requestedReviewers = normalizeUserList(dto.requestedReviewers);
  const allReviewers = reviewers.concat(requestedReviewers);
  return {
    userId,
    repoId: resolveRepoId(ctx.repoIdMap, dto.repoId, 'pull'),
    number,
    state: checkEnum(dto.state, STATES, 'state', 'pull', identity),
    title: truncate(titleText, 200),
    body: truncate(asText(dto.body) ?? '', 500) || null,
    createdAt: asDate(dto.createdAt, { field: 'createdAt', resource: 'pull', identity, required: true }),
    updatedAt: asDate(dto.updatedAt, { field: 'updatedAt', resource: 'pull', identity, required: false }),
    closedAt: asDate(dto.closedAt, { field: 'closedAt', resource: 'pull', identity, required: false }),
    mergedAt: asDate(dto.mergedAt, { field: 'mergedAt', resource: 'pull', identity, required: false }),
    author,
    authorLogin: author && typeof author.login === 'string' ? author.login : null,
    isAuthoredByUser: Boolean(userLogin && author && author.login === userLogin),
    isReviewedByUser: Boolean(userLogin && allReviewers.some((r) => r.login === userLogin)),
    authorAssociation: asText(dto.authorAssociation),
    draft: Boolean(dto.draft),
    additions: asCount(dto.additions, 0),
    deletions: asCount(dto.deletions, 0),
    changedFiles: asCount(dto.changedFiles, 0),
    commits: asCount(dto.commits, 0),
    comments: asCount(dto.comments, 0),
    reviewComments: asCount(dto.reviewComments, 0),
    baseRef: asText(dto.baseRef),
    baseSha: asText(dto.baseSha),
    baseRepo: normalizeSlimRepo(dto.baseRepo),
    headRef: asText(dto.headRef),
    headSha: asText(dto.headSha),
    headRepo: normalizeSlimRepo(dto.headRepo),
    merged: Boolean(dto.merged),
    mergedBy: normalizeUser(dto.mergedBy),
    requestedReviewers,
    reviewers,
    labels: Array.isArray(dto.labels) ? dto.labels.filter((l) => typeof l === 'string') : [],
    lastSyncedAt: null,
    fetchedAt: asDate(dto.fetchedAt, { field: 'fetchedAt', resource: 'pull', identity, required: true }),
    source: checkEnum(dto.source, SOURCES, 'source', 'pull', identity),
  };
}

module.exports = { normalizePullRequest, STATES, SOURCES };
