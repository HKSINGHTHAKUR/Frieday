/**
 * Focus-area tagging (T4.1) — deterministic keyword/path/language rules.
 *
 * Version: FOCUS_RULES_VERSION = 1
 *
 * Rules (v1) are defined in focus-rules.js:
 *   - API work: paths matching api|server|routes|controller|endpoint + languages JS/TS/Go/Python/Java
 *   - Database work: paths matching migration|schema|sql|model|repository|orm|prisma|sequelize + languages SQL/Python/Go
 *   - Frontend work: paths matching component|page|view|css|style|ui|react|vue|svelte + languages JS/TS/CSS/HTML
 *   - DevOps/Infra: paths matching docker|k8s|kubernetes|terraform|ansible|ci|cd|pipeline|workflow|github|gitlab + languages YAML/Dockerfile/HCL/Shell
 *   - Documentation: paths matching readme|doc|mdx|md + languages Markdown
 *   - Testing: paths matching test|spec|__tests__|cypress|playwright|jest + languages JS/TS/Python
 *   - CLI/Tooling: paths matching cli|command|bin|script|tool + languages JS/TS/Go/Python/Rust/Shell
 *
 * Evidence collection:
 *   - repoNames: unique repository names where the focus rule matched
 *   - filePaths: sample of matching file paths (up to 5 per tag)
 *
 * Confidence:
 *   - High: >= 10 matching commits across >= 2 repos
 *   - Medium: >= 5 matching commits
 *   - Low: < 5 matching commits OR single repo
 *
 * Pure: no I/O, no mutation, no wall-clock, no randomness.
 */

const { FOCUS_RULES, CONFIDENCE_THRESHOLDS } = require('./focus-rules');
const FOCUS_RULES_VERSION = 1;

/**
 * Language keys for either runtime shape of LanguageSnapshot.bytes:
 * a Mongoose Map (full documents / test fixtures) or a plain object
 * (Mongoose .lean() reads — the composer feeds lean docs).
 * @param {Map<string, number>|Record<string, number>|null|undefined} bytes
 * @returns {string[]}
 */
function byteKeys(bytes) {
  if (!bytes) return [];
  if (bytes instanceof Map) return [...bytes.keys()];
  return Object.keys(bytes);
}

/**
 * Check if a commit's file paths match a rule's keywords.
 * @param {string[]} filePaths - array of file paths from commit.files
 * @param {string[]} keywords - rule keywords
 * @returns {string[]} matched file paths
 */
function matchFiles(filePaths, keywords) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
  const matched = [];
  for (const path of filePaths) {
    const lower = path.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        matched.push(path);
        break; // one match per file is enough
      }
    }
  }
  return matched;
}

/**
 * Check if a language matches the rule's language filter.
 * @param {string} language - language name from LanguageSnapshot
 * @param {string[]} ruleLanguages - rule's allowed languages (empty = any)
 * @returns {boolean}
 */
function matchesLanguage(language, ruleLanguages) {
  if (!ruleLanguages || ruleLanguages.length === 0) return true;
  const lower = language.toLowerCase();
  return ruleLanguages.some((l) => lower.includes(l.toLowerCase()));
}

/**
 * Build lookup maps for repositories and language snapshots.
 * @param {Array} repositories - Repository docs with _id, name, owner
 * @param {Array} languageSnapshots - LanguageSnapshot docs with repoId, bytes Map
 * @returns {Object} { repoNames, latestLangByRepo }
 */
function buildRepoLookups(repositories, languageSnapshots) {
  const repoNames = new Map();
  for (const repo of repositories) {
    if (repo._id) repoNames.set(repo._id.toString(), repo.fullName || `${repo.owner}/${repo.name}`);
  }

  const latestLangByRepo = new Map();
  for (const snap of languageSnapshots) {
    if (!snap.repoId || !snap.fetchedAt) continue;
    const key = snap.repoId.toString();
    const existing = latestLangByRepo.get(key);
    if (!existing || snap.fetchedAt > existing.fetchedAt) {
      latestLangByRepo.set(key, snap);
    }
  }

  return { repoNames, latestLangByRepo };
}

/**
 * Match a single commit against all focus rules.
 * @param {Object} commit - Commit doc with repoId, files
 * @param {Map} repoNames - repoId -> repo name
 * @param {Map} latestLangByRepo - repoId -> latest LanguageSnapshot
 * @returns {Map} rule tag -> { commits: number, repos: Set, files: string[] }
 */
function matchCommitToRules(commit, repoNames, latestLangByRepo) {
  if (!commit.files || !Array.isArray(commit.files) || commit.files.length === 0) return new Map();
  if (!commit.repoId) return new Map();

  const repoKey = commit.repoId.toString();
  const repoName = repoNames.get(repoKey) || repoKey;
  const snapshot = latestLangByRepo.get(repoKey);
  const languages = snapshot ? byteKeys(snapshot.bytes) : [];

  const ruleMatches = new Map();
  for (const rule of FOCUS_RULES) {
    // Language filter
    const langMatch = languages.some((l) => matchesLanguage(l, rule.languages));
    if (!langMatch) continue;

    // File path match
    const matchedFiles = matchFiles(commit.files, rule.keywords);
    if (matchedFiles.length === 0) continue;

    // Record match
    const entry = ruleMatches.get(rule.tag) || { commits: 0, repos: new Set(), files: [] };
    entry.commits += 1;
    entry.repos.add(repoName);
    for (const f of matchedFiles) {
      if (!entry.files.includes(f) && entry.files.length < 5) {
        entry.files.push(f);
      }
    }
    ruleMatches.set(rule.tag, entry);
  }
  return ruleMatches;
}

/**
 * Merge rule matches from multiple commits.
 * @param {Map} accumulator - accumulated rule matches
 * @param {Map} newMatches - new rule matches to merge
 * @returns {Map} merged rule matches
 */
function mergeRuleMatches(accumulator, newMatches) {
  for (const [tag, data] of newMatches.entries()) {
    const entry = accumulator.get(tag) || { commits: 0, repos: new Set(), files: [] };
    entry.commits += data.commits;
    for (const repo of data.repos) entry.repos.add(repo);
    for (const f of data.files) {
      if (!entry.files.includes(f) && entry.files.length < 5) {
        entry.files.push(f);
      }
    }
    accumulator.set(tag, entry);
  }
  return accumulator;
}

/**
 * Determine confidence level for a rule match.
 * @param {Object} data - { commits: number, repos: Set }
 * @param {Object} rule - the focus rule
 * @returns {string} 'High', 'Medium', or 'Low'
 */
function computeConfidence(data, rule) {
  const minHigh = rule?.minCommitsForHigh ?? CONFIDENCE_THRESHOLDS.HIGH_MIN_COMMITS;
  const minMed = rule?.minCommitsForMedium ?? CONFIDENCE_THRESHOLDS.MEDIUM_MIN_COMMITS;

  if (data.commits >= minHigh && data.repos.size >= CONFIDENCE_THRESHOLDS.HIGH_MIN_REPOS) {
    return 'High';
  }
  if (data.commits >= minMed) {
    return 'Medium';
  }
  return 'Low';
}

/**
 * Build final results array with confidence and sorting.
 * @param {Map} ruleMatches - rule tag -> { commits, repos, files }
 * @returns {Array} sorted focus tags
 */
function buildFocusResults(ruleMatches) {
  const results = [];
  for (const [tag, data] of ruleMatches.entries()) {
    const rule = FOCUS_RULES.find((r) => r.tag === tag);
    const confidence = computeConfidence(data, rule);
    results.push({
      tag,
      confidence,
      evidence: {
        repoNames: Array.from(data.repos),
        filePaths: data.files,
      },
    });
  }

  // Sort by confidence (High > Medium > Low), then by repo count desc
  const confidenceOrder = { High: 3, Medium: 2, Low: 1 };
  results.sort((a, b) => {
    const ca = confidenceOrder[a.confidence] || 0;
    const cb = confidenceOrder[b.confidence] || 0;
    if (ca !== cb) return cb - ca;
    return b.evidence.repoNames.length - a.evidence.repoNames.length;
  });

  return results;
}

/**
 * Compute focus tags from commits and language snapshots.
 *
 * @param {Object} opts
 * @param {Array} opts.commits - Commit docs with repoId, files (string[]), language (from repo context)
 * @param {Array} opts.languageSnapshots - LanguageSnapshot docs with repoId, bytes Map
 * @param {Array} opts.repositories - Repository docs with _id, name, owner
 * @returns {Array} focus tags: { tag, confidence, evidence: { repoNames, filePaths } }
 */
function computeFocusTags({ commits = [], languageSnapshots = [], repositories = [] } = {}) {
  const { repoNames, latestLangByRepo } = buildRepoLookups(repositories, languageSnapshots);

  // Accumulate matches per rule across all commits
  const ruleMatches = new Map();

  for (const commit of commits) {
    const newMatches = matchCommitToRules(commit, repoNames, latestLangByRepo);
    mergeRuleMatches(ruleMatches, newMatches);
  }

  return buildFocusResults(ruleMatches);
}

/**
 * Compute focus tags for a single repository.
 */
function computeRepoFocusTags({ commits = [], languageSnapshots = [], repositories = [], repoId } = {}) {
  const filteredRepos = repositories.filter((r) => r._id && r._id.toString() === repoId.toString());
  const filteredCommits = commits.filter((c) => c.repoId && c.repoId.toString() === repoId.toString());
  const filteredSnaps = languageSnapshots.filter(
    (ls) => ls.repoId && ls.repoId.toString() === repoId.toString()
  );
  return computeFocusTags({
    commits: filteredCommits,
    languageSnapshots: filteredSnaps,
    repositories: filteredRepos,
  });
}

module.exports = {
  FOCUS_RULES_VERSION,
  FOCUS_RULES,
  CONFIDENCE_THRESHOLDS,
  computeFocusTags,
  computeRepoFocusTags,
};
