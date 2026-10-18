/**
 * AI output validation (T6.1, prd.md §19, architecture.md §11).
 *
 * Deterministic allowlist check of LLM output BEFORE it reaches callers:
 * - shape: { paraphrase, whyItMatters? }
 * - length: paraphrase ≤80 words, whyItMatters ≤30 words
 * - numbers: every numeric token must exist in the supplied input
 * - repositories: every `owner/name` token must exist in the supplied input
 * - claims: rejects expertise/mastery/guarantee-style claims outright
 *
 * The AI layer explains deterministic facts — it never calculates. A failed
 * validation is a typed result the caller falls back on (TemplateExplainer);
 * invalid output is never silently accepted.
 */

const MAX_PARAPHRASE_WORDS = 80;
const MAX_WHY_WORDS = 30;

const REASONS = {
  BAD_SHAPE: 'BAD_SHAPE',
  TOO_LONG: 'TOO_LONG',
  UNSUPPORTED_CLAIM: 'UNSUPPORTED_CLAIM',
  NEW_NUMBER: 'NEW_NUMBER',
  UNKNOWN_REPO: 'UNKNOWN_REPO',
};

/** Clearly unsafe generated claims (prd.md §18 honesty rules). */
const UNSAFE_CLAIM_PATTERNS = [
  /\bexperts?\b/i,
  /\bmastery\b/i,
  /\bmaster(ed|s|ing)?\b/i,
  /\btop\s*1(\.1|0)?%/i,
  /\bbest\s+developer\b/i,
  /\bsenior[\s-]?level\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bskill\s+level\b/i,
];

/** @param {string} text */
function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Numeric tokens in a string ("12%", "45/120", "1,200 commits" → {12}, {45,120}, {1200}).
 * @param {string} text
 * @returns {Set<string>}
 */
function numericTokens(text) {
  const out = new Set();
  for (const match of String(text ?? '').match(/\d+(?:[.,]\d+)?/g) ?? []) {
    out.add(match.replace(/,/g, ''));
  }
  return out;
}

/**
 * `owner/name`-shaped repository tokens ("tester/app").
 * @param {string} text
 * @returns {Set<string>} lowercased
 */
function repoTokens(text) {
  const out = new Set();
  for (const match of String(text ?? '').match(/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/gi) ?? []) {
    out.add(match.toLowerCase());
  }
  return out;
}

/** @param {string} text */
function hasUnsafeClaim(text) {
  return UNSAFE_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The only values the AI may echo: numbers/repos derived from the strict
 * contract input (insightText, metrics, evidenceSummary, timeRange).
 * @param {{ insightText: string, metrics: object, evidenceSummary: object, timeRange: string }} insightInput
 */
function buildAllowlists(insightInput) {
  const parts = [
    insightInput.insightText ?? '',
    safeJson(insightInput.metrics),
    safeJson(insightInput.evidenceSummary),
    insightInput.timeRange ?? '',
  ];
  const numbers = new Set();
  const repos = new Set();
  for (const part of parts) {
    for (const token of numericTokens(part)) numbers.add(token);
    for (const token of repoTokens(part)) repos.add(token);
  }
  return { numbers, repos };
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '';
  }
}

function checkShape(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: REASONS.BAD_SHAPE, detail: 'output must be an object' };
  }
  if (typeof raw.paraphrase !== 'string' || raw.paraphrase.trim().length === 0) {
    return { ok: false, reason: REASONS.BAD_SHAPE, detail: 'paraphrase is required' };
  }
  if (raw.whyItMatters !== undefined && raw.whyItMatters !== null && typeof raw.whyItMatters !== 'string') {
    return { ok: false, reason: REASONS.BAD_SHAPE, detail: 'whyItMatters must be a string' };
  }
  return { ok: true };
}

function checkLengths(paraphrase, whyItMatters) {
  if (countWords(paraphrase) > MAX_PARAPHRASE_WORDS) {
    return { ok: false, reason: REASONS.TOO_LONG, detail: 'paraphrase exceeds 80 words' };
  }
  if (whyItMatters && countWords(whyItMatters) > MAX_WHY_WORDS) {
    return { ok: false, reason: REASONS.TOO_LONG, detail: 'whyItMatters exceeds 30 words' };
  }
  return { ok: true };
}

function checkClaims(paraphrase, whyItMatters) {
  if (hasUnsafeClaim(paraphrase) || (whyItMatters && hasUnsafeClaim(whyItMatters))) {
    return { ok: false, reason: REASONS.UNSUPPORTED_CLAIM, detail: 'unsupported expertise/claim language' };
  }
  return { ok: true };
}

function checkNumbers(paraphrase, whyItMatters, allow) {
  const outputNumbers = new Set([...numericTokens(paraphrase), ...numericTokens(whyItMatters ?? '')]);
  for (const token of outputNumbers) {
    if (!allow.numbers.has(token)) {
      return { ok: false, reason: REASONS.NEW_NUMBER, detail: `number not in input: ${token}` };
    }
  }
  return { ok: true };
}

function checkRepos(paraphrase, whyItMatters, allow) {
  const outputRepos = new Set([...repoTokens(paraphrase), ...repoTokens(whyItMatters ?? '')]);
  for (const token of outputRepos) {
    if (!allow.repos.has(token)) {
      return { ok: false, reason: REASONS.UNKNOWN_REPO, detail: `repository not in input: ${token}` };
    }
  }
  return { ok: true };
}

/**
 * Validate a raw LLM response against the strict contract input.
 * @param {unknown} raw parsed provider response
 * @param {object} insightInput the exact AI contract input
 * @returns {{ ok: true, value: { paraphrase: string, whyItMatters?: string } } |
 *           { ok: false, reason: string, detail: string }}
 */
function validateAiOutput(raw, insightInput) {
  const shape = checkShape(raw);
  if (!shape.ok) return shape;

  const paraphrase = raw.paraphrase.trim();
  const whyItMatters =
    raw.whyItMatters === null || raw.whyItMatters === undefined ? undefined : raw.whyItMatters.trim();

  for (const check of [
    () => checkLengths(paraphrase, whyItMatters),
    () => checkClaims(paraphrase, whyItMatters),
    () => checkNumbers(paraphrase, whyItMatters, buildAllowlists(insightInput)),
    () => checkRepos(paraphrase, whyItMatters, buildAllowlists(insightInput)),
  ]) {
    const result = check();
    if (!result.ok) return result;
  }

  const value = whyItMatters ? { paraphrase, whyItMatters } : { paraphrase };
  return { ok: true, value };
}

module.exports = {
  REASONS,
  MAX_PARAPHRASE_WORDS,
  MAX_WHY_WORDS,
  countWords,
  numericTokens,
  repoTokens,
  validateAiOutput,
};
