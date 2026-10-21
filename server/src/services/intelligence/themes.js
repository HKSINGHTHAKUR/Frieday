/**
 * Commit-theme clustering (Phase 10.1) — deterministic classification of
 * commit messages into coarse work themes.
 *
 * Version: THEME_RULES_VERSION = 1
 *
 * What this does NOT do (prd.md §2, §18; rules.md §24):
 *   - It does not infer developer intent, skill, or specialization. A theme
 *     means "N commit messages contained term X", nothing more.
 *   - It does not use an LLM. Every classification is a literal rule match
 *     over the commit headline the author wrote.
 *   - It does not scan commit bodies in v1 (`messageFull`) — bodies are
 *     truncated prose and raise false positives (e.g. a changelog mentioning
 *     a bug is not a bug fix).
 *
 * Buckets (every commit lands in exactly one, and they reconcile):
 *   - a theme          → the commit matched a theme rule
 *   - unclassified     → a headline existed but matched no theme term
 *   - noMessage        → headline was null/empty/whitespace
 *   - noise            → maintenance/noise signal (chore, merge, bump, …)
 *
 * Denominator: theme percentages are computed over THEMED commits only
 * (`themedCommits`), never over all commits. The UI must show that
 * denominator — percentages over all commits would silently hide the
 * unclassified/noise/noMessage buckets and overstate the result.
 *
 * Pure: no I/O, no mutation, no wall-clock, no randomness. Input docs are
 * never modified.
 */

const {
  THEME_PREFIXES,
  MAINTENANCE_PREFIXES,
  THEME_TOKENS,
  THEME_PRIORITY,
  NOISE_TOKENS,
  NOISE_PHRASES,
  THEME_CONFIDENCE_THRESHOLDS,
  THEME_EVIDENCE_LIMITS,
} = require('./theme-rules');

const THEME_RULES_VERSION = 1;
const THEME_OUTPUT_VERSION = 1;

/** Themes that carry meaning, in the documented conflict-resolution order. */
const THEME_NAMES = Object.freeze([...THEME_PRIORITY]);

/** Conventional-commit prefix → theme lookup (built once). */
const PREFIX_TO_THEME = (() => {
  const map = new Map();
  for (const [theme, prefixes] of Object.entries(THEME_PREFIXES)) {
    for (const prefix of prefixes) map.set(prefix, theme);
  }
  return map;
})();

const NOISE_TOKEN_SET = new Set(NOISE_TOKENS);
const MAINTENANCE_PREFIX_SET = new Set(MAINTENANCE_PREFIXES);

/**
 * Split a headline into lowercase word tokens.
 * Tokens are runs of letters/digits — so `prefix` yields ["prefix"] and
 * never contains "fix"; `authentication` yields ["authentication"] and
 * never contains "auth".
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Parse a conventional-commit type from a headline.
 * Matches `type:` or `type(scope):` at the very start of the headline.
 * @param {string} headline
 * @returns {string|null} lowercase type, or null when there is no prefix
 */
function parseConventionalPrefix(headline) {
  if (typeof headline !== 'string') return null;
  const match = /^\s*([a-z]+)(?:\([^)]*\))?\s*:\s*/i.exec(headline);
  if (!match) return null;
  return match[1].toLowerCase();
}

/**
 * Detect a maintenance/noise signal in a headline.
 * @param {string} headline raw headline
 * @param {string} lower lowercased headline
 * @returns {boolean}
 */
function isNoise(headline, lower) {
  if (parseConventionalPrefix(headline) && MAINTENANCE_PREFIX_SET.has(parseConventionalPrefix(headline))) {
    return true;
  }
  for (const phrase of NOISE_PHRASES) {
    if (lower.includes(phrase)) return true;
  }
  const tokens = tokenize(lower);
  return tokens.some((t) => NOISE_TOKEN_SET.has(t));
}

/**
 * Classify a single commit headline.
 * @param {string|null|undefined} headline
 * @returns {{ bucket: 'theme'|'unclassified'|'noMessage'|'noise', theme: string|null, matchedBy: string|null }}
 */
function classifyHeadline(headline) {
  if (typeof headline !== 'string' || headline.trim().length === 0) {
    return { bucket: 'noMessage', theme: null, matchedBy: null };
  }

  const lower = headline.toLowerCase();

  if (isNoise(headline, lower)) {
    return { bucket: 'noise', theme: null, matchedBy: null };
  }

  // 1. Conventional prefix wins — it is the author's explicit type.
  const prefix = parseConventionalPrefix(headline);
  if (prefix) {
    const theme = PREFIX_TO_THEME.get(prefix);
    if (theme) return { bucket: 'theme', theme, matchedBy: 'prefix' };
  }

  // 2. Exact token match, resolved through the documented priority order:
  //    for each theme in THEME_PRIORITY, check whether ANY token in the
  //    message belongs to that theme. Priority order — not word order —
  //    decides the winner, so the result never depends on how the words
  //    happen to be arranged.
  const tokens = tokenize(lower);
  const tokenSet = new Set(tokens);
  for (const theme of THEME_PRIORITY) {
    const themeTokens = THEME_TOKENS[theme] || [];
    for (const token of themeTokens) {
      if (tokenSet.has(token)) return { bucket: 'theme', theme, matchedBy: 'token' };
    }
  }

  return { bucket: 'unclassified', theme: null, matchedBy: null };
}

/**
 * Determine confidence for a theme bucket, reusing the established
 * intelligence semantics (focus.js / insights-core.js).
 *
 * Scope matters: the cross-repo "High" tier additionally requires corroboration
 * from >= 2 repositories. A per-repository breakdown cannot claim that, so the
 * per-repo scope uses the commit-count dimension only — it never borrows the
 * cross-repo tier.
 * @param {{ commits: number, repos: number }} data
 * @param {'cross-repo'|'per-repo'} [scope]
 * @returns {'High'|'Medium'|'Low'}
 */
function computeThemeConfidence(data, scope = 'cross-repo') {
  const { HIGH_MIN_COMMITS, HIGH_MIN_REPOS, MEDIUM_MIN_COMMITS } = THEME_CONFIDENCE_THRESHOLDS;
  if (scope === 'per-repo') {
    if (data.commits >= HIGH_MIN_COMMITS) return 'High';
    if (data.commits >= MEDIUM_MIN_COMMITS) return 'Medium';
    return 'Low';
  }
  if (data.commits >= HIGH_MIN_COMMITS && data.repos >= HIGH_MIN_REPOS) return 'High';
  if (data.commits >= MEDIUM_MIN_COMMITS) return 'Medium';
  return 'Low';
}

/**
 * Canonical theme ranking — the ONE rule used for the displayed order of the
 * theme list AND for the top-theme chip.
 *
 * Order:
 *   1. confidence desc (High → Medium → Low)
 *   2. commit count desc
 *   3. THEME_PRIORITY asc (Bug fix → Security → Performance → Testing →
 *      Documentation → Refactor → Feature) — the documented conflict-
 *      resolution order, so a tie resolves by the same taxonomy the
 *      classifier itself uses
 *   4. theme name asc (a total order, so the result never depends on input
 *      or database result order)
 *
 * The chip and the first row of the drill-down therefore always agree: both
 * are this comparator applied to the same item list.
 */
const CONFIDENCE_ORDER = { High: 3, Medium: 2, Low: 1 };

const THEME_PRIORITY_INDEX = new Map(THEME_PRIORITY.map((theme, index) => [theme, index]));

/**
 * Compare two theme items by the canonical ranking.
 * @param {{theme: string, commitCount: number, confidence: string}} a
 * @param {{theme: string, commitCount: number, confidence: string}} b
 * @returns {number} negative when `a` ranks first
 */
function compareThemeItems(a, b) {
  const ca = CONFIDENCE_ORDER[a.confidence] || 0;
  const cb = CONFIDENCE_ORDER[b.confidence] || 0;
  if (ca !== cb) return cb - ca;
  if (a.commitCount !== b.commitCount) return b.commitCount - a.commitCount;
  const pa = THEME_PRIORITY_INDEX.has(a.theme) ? THEME_PRIORITY_INDEX.get(a.theme) : Number.MAX_SAFE_INTEGER;
  const pb = THEME_PRIORITY_INDEX.has(b.theme) ? THEME_PRIORITY_INDEX.get(b.theme) : Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return a.theme.localeCompare(b.theme);
}

/**
 * Deterministic top-theme selection for a set of theme items.
 *
 * The top theme is the FIRST item under the canonical ranking
 * (`compareThemeItems`) — the same rule that orders the displayed list, so the
 * chip and the drill-down can never contradict each other.
 * @param {Array<{theme: string, commitCount: number, share: number, confidence: string}>} items
 * @returns {{ theme: string, commitCount: number, share: number, confidence: string }|null}
 */
function pickTopTheme(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const top = [...items].sort(compareThemeItems)[0];
  return {
    theme: top.theme,
    commitCount: top.commitCount,
    share: top.share,
    confidence: top.confidence,
  };
}

/**
 * Compute commit themes from commits.
 *
 * @param {Object} opts
 * @param {Array} opts.commits - Commit docs with messageHeadline, sha, repoId
 * @param {Array} [opts.repositories] - Repository docs with _id, fullName
 * @param {'cross-repo'|'per-repo'} [opts.scope] - confidence semantics
 * @returns {Object} theme payload (see module header for the shape)
 */
function computeThemes({ commits = [], repositories = [], scope = 'cross-repo' } = {}) {
  const repoNames = new Map();
  for (const repo of repositories) {
    if (repo && repo._id) {
      repoNames.set(repo._id.toString(), repo.fullName || `${repo.owner}/${repo.name}`);
    }
  }

  const buckets = new Map();
  let noMessage = 0;
  let noise = 0;
  let unclassified = 0;
  let totalCommits = 0;

  for (const commit of commits) {
    // A malformed record (null / undefined / not an object) is skipped, not
    // counted and not classified: it is an invalid record, not a commit with
    // no message. It must never crash the aggregation of its valid siblings,
    // and it must never be invented into a theme.
    if (!commit || typeof commit !== 'object') continue;
    totalCommits += 1;

    const headline = commit.messageHeadline;
    const { bucket, theme } = classifyHeadline(headline);

    if (bucket === 'noMessage') {
      noMessage += 1;
      continue;
    }
    if (bucket === 'noise') {
      noise += 1;
      continue;
    }
    if (bucket === 'unclassified') {
      unclassified += 1;
      continue;
    }

    const entry = buckets.get(theme) || {
      commits: 0,
      repos: new Set(),
      shas: [],
      samples: [],
    };
    entry.commits += 1;

    const repoKey = commit.repoId ? commit.repoId.toString() : null;
    if (repoKey) entry.repos.add(repoNames.get(repoKey) || repoKey);

    if (commit.sha && entry.shas.length < THEME_EVIDENCE_LIMITS.MAX_COMMIT_SHAS) {
      entry.shas.push(commit.sha);
    }
    // Bounded headline samples: evidence the user can inspect. Never the body.
    if (
      typeof headline === 'string' &&
      headline.trim().length > 0 &&
      entry.samples.length < THEME_EVIDENCE_LIMITS.MAX_SAMPLE_MESSAGES
    ) {
      entry.samples.push(headline.trim());
    }

    buckets.set(theme, entry);
  }

  const themedCommits = [...buckets.values()].reduce((sum, e) => sum + e.commits, 0);

  const items = [];
  for (const theme of THEME_NAMES) {
    const entry = buckets.get(theme);
    if (!entry) continue;
    // Sorted so the payload never depends on the order commits were read in
    // (a stable, order-independent contract for the same input set).
    const repoNameList = [...entry.repos].sort().slice(0, THEME_EVIDENCE_LIMITS.MAX_REPO_NAMES);
    items.push({
      theme,
      confidence: computeThemeConfidence({ commits: entry.commits, repos: entry.repos.size }, scope),
      commitCount: entry.commits,
      share: themedCommits > 0 ? Math.round((entry.commits / themedCommits) * 1000) / 1000 : 0,
      evidence: {
        repoNames: repoNameList,
        commitShas: [...entry.shas].sort().slice(0, THEME_EVIDENCE_LIMITS.MAX_COMMIT_SHAS),
        sampleMessages: [...entry.samples].sort().slice(0, THEME_EVIDENCE_LIMITS.MAX_SAMPLE_MESSAGES),
      },
    });
  }

  // Canonical ordering — the SAME comparator that selects the top theme, so
  // the chip and the first displayed row can never disagree.
  items.sort(compareThemeItems);

  return {
    version: THEME_OUTPUT_VERSION,
    rulesVersion: THEME_RULES_VERSION,
    totalCommits,
    themedCommits,
    unclassified,
    noMessage,
    noise,
    items,
    topTheme: pickTopTheme(items),
  };
}

/**
 * Compute commit themes for a SINGLE repository.
 *
 * Mirrors `focus.js` `computeRepoFocusTags` exactly: the same classifier,
 * the same taxonomy, the same precedence — only the commit set is filtered
 * to one repository. No second taxonomy, no divergent rules.
 *
 * Malformed commit records (null / undefined / not an object) are skipped
 * here, exactly as `computeThemes` skips them, so one bad record can never
 * crash a repository's aggregation or abort its valid siblings.
 *
 * @param {Object} opts
 * @param {Array} opts.commits - Commit docs (any repos; filtered here)
 * @param {Array} [opts.repositories] - Repository docs with _id, fullName
 * @param {string} opts.repoId - the repository to analyse
 * @returns {Object} per-repo theme payload
 */
function computeRepoThemes({ commits = [], repositories = [], repoId } = {}) {
  if (!repoId) {
    return emptyThemePayload();
  }
  const key = repoId.toString();
  const filteredCommits = commits.filter(
    (c) => c && typeof c === 'object' && c.repoId && c.repoId.toString() === key
  );
  const filteredRepos = repositories.filter((r) => r && r._id && r._id.toString() === key);
  return computeThemes({
    commits: filteredCommits,
    repositories: filteredRepos,
    scope: 'per-repo',
  });
}

/**
 * An empty theme payload — used for repositories with no commits, so every
 * repository in the response has a well-formed entry (no undefined holes).
 * @returns {Object}
 */
function emptyThemePayload() {
  return {
    version: THEME_OUTPUT_VERSION,
    rulesVersion: THEME_RULES_VERSION,
    totalCommits: 0,
    themedCommits: 0,
    unclassified: 0,
    noMessage: 0,
    noise: 0,
    items: [],
    topTheme: null,
  };
}

/**
 * Compute the per-repository theme map for a set of repositories.
 *
 * One map, one response — the frontend never issues a request per repository.
 * Every requested repository gets an entry, including repositories with no
 * commits (an empty payload), so the map is a complete, stable index.
 *
 * The commits are grouped by repository ONCE, so the cost is linear in the
 * number of commits rather than linear in commits x repositories.
 *
 * @param {Object} opts
 * @param {Array} opts.commits - user-scoped commit docs
 * @param {Array} opts.repositories - repository docs with _id, fullName
 * @returns {Object} map of repoId -> per-repo theme payload
 */
function computeRepoThemesMap({ commits = [], repositories = [] } = {}) {
  const byRepo = new Map();
  for (const commit of commits) {
    if (!commit || typeof commit !== 'object' || !commit.repoId) continue;
    const key = commit.repoId.toString();
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push(commit);
  }

  const map = {};
  for (const repo of repositories) {
    if (!repo || !repo._id) continue;
    const key = repo._id.toString();
    map[key] = computeThemes({
      commits: byRepo.get(key) ?? [],
      repositories: [repo],
      scope: 'per-repo',
    });
  }
  return map;
}

module.exports = {
  THEME_RULES_VERSION,
  THEME_OUTPUT_VERSION,
  THEME_NAMES,
  compareThemeItems,
  computeThemes,
  computeRepoThemes,
  computeRepoThemesMap,
  pickTopTheme,
  classifyHeadline,
  tokenize,
  parseConventionalPrefix,
};
