/**
 * Language aggregation (T4.1) — pure functions for byte-weight and commit-share.
 *
 * Input: arrays of Commit docs and LanguageSnapshot docs.
 * Output: two distinct aggregations:
 *   A. weighted bytes (weighted by user's commit share per repo)
 *   B. commit-count share
 *
 * The weighted-byte heuristic (architecture.md §10, PRD §18):
 * For each repo, compute the user's commit fraction of total commits in that repo.
 * Then weight the repo's language bytes by that fraction.
 * Sum across repos.
 *
 * Commit-share output: total commits per language across all repos.
 *
 * Pure: no I/O, no mutation, no wall-clock, no randomness.
 */

const LANGUAGE_OUTPUT_VERSION = 1;

/**
 * Language-byte pairs for either runtime shape of LanguageSnapshot.bytes:
 * a Mongoose Map (full documents / test fixtures) or a plain object
 * (Mongoose .lean() reads — the composer feeds lean docs). Order is
 * preserved (Map insertion order / object key order), so aggregation
 * semantics are identical for both shapes.
 * @param {Map<string, number>|Record<string, number>|null|undefined} bytes
 * @returns {Array<[string, number]>}
 */
function byteEntries(bytes) {
  if (!bytes) return [];
  if (bytes instanceof Map) return [...bytes.entries()];
  return Object.entries(bytes);
}

/**
 * Compute language aggregations from raw data.
 *
 * @param {Object} opts
 * @param {Array} opts.commits - Commit docs with repoId, additions, deletions
 * @param {Array} opts.languageSnapshots - LanguageSnapshot docs with repoId, bytes Map
 * @param {Object} [opts.repoFilter] - optional { repoId }
 * @returns {Object} { weightedBytes, commitShare, version }
 *   weightedBytes: { language: bytes (number), ... }  -- weighted by commit share
 *   commitShare:   { language: commits (number), ... } -- raw commit count
 *   version: LANGUAGE_OUTPUT_VERSION
 */
function computeLanguageAggregation({ commits = [], languageSnapshots = [], repoFilter = null } = {}) {
  // Filter by repo if needed
  const relevantCommits = repoFilter
    ? commits.filter((c) => c.repoId && c.repoId.toString() === repoFilter.repoId.toString())
    : commits;
  const relevantSnapshots = repoFilter
    ? languageSnapshots.filter((ls) => ls.repoId && ls.repoId.toString() === repoFilter.repoId.toString())
    : languageSnapshots;

  // Step 1: Compute total commits per repo (for weighting)
  const commitsByRepo = new Map();
  for (const c of relevantCommits) {
    if (!c.repoId) continue;
    const key = c.repoId.toString();
    commitsByRepo.set(key, (commitsByRepo.get(key) || 0) + 1);
  }

  // Step 2: Compute user's commit share per repo
  // Note: We only have the user's own commits from the sync.
  // For true commit share, we'd need total repo commits (all authors).
  // Since we only have the user's commits, the "share" is 1.0 for repos
  // where the user has commits, 0 otherwise.
  // This is the documented heuristic limitation - we weight by presence of user's commits.
  // Future V1 could fetch total repo commit counts.
  const commitShareByRepo = new Map();
  for (const [repoId, count] of commitsByRepo) {
    commitShareByRepo.set(repoId, count > 0 ? 1.0 : 0.0);
  }

  // Step 3: Build latest snapshot per repo
  const latestSnapshotByRepo = new Map();
  for (const snapshot of relevantSnapshots) {
    if (!snapshot.repoId || !snapshot.fetchedAt) continue;
    const key = snapshot.repoId.toString();
    const existing = latestSnapshotByRepo.get(key);
    if (!existing || snapshot.fetchedAt > existing.fetchedAt) {
      latestSnapshotByRepo.set(key, snapshot);
    }
  }

  // Step 4: Aggregate language bytes weighted by commit share
  // Use only the latest snapshot per repo
  const weightedBytes = new Map(); // language -> weighted bytes
  for (const [repoKey, snapshot] of latestSnapshotByRepo.entries()) {
    const share = commitShareByRepo.get(repoKey) || 0;
    if (share === 0 || !snapshot.bytes) continue;

    for (const [lang, bytes] of byteEntries(snapshot.bytes)) {
      if (bytes === 0) continue; // Skip zero-byte languages
      const current = weightedBytes.get(lang) || 0;
      weightedBytes.set(lang, current + bytes * share);
    }
  }

  // Step 5: Compute commit-count share (raw commits per language)
  // We need to attribute commits to languages.
  // Since commits don't have language directly, we attribute by repo.
  // Each commit in a repo "belongs" to the languages in that repo proportionally.
  // This is a heuristic: distribute each commit's count across the repo's languages
  // by their byte proportion in the latest snapshot.
  const commitShare = new Map(); // language -> commit count

  for (const c of relevantCommits) {
    if (!c.repoId) continue;
    const repoKey = c.repoId.toString();
    const snapshot = latestSnapshotByRepo.get(repoKey);
    if (!snapshot || !snapshot.bytes) continue;

    const entries = byteEntries(snapshot.bytes);
    if (entries.length === 0) continue;

    const totalBytes = entries.reduce((sum, entry) => sum + entry[1], 0);
    if (totalBytes === 0) continue;

    // Distribute this 1 commit proportionally by bytes
    for (const [lang, bytes] of entries) {
      const share = bytes / totalBytes;
      commitShare.set(lang, (commitShare.get(lang) || 0) + share);
    }
  }

  // Convert to plain objects, round weighted bytes
  const weightedBytesOut = {};
  for (const [lang, bytes] of weightedBytes.entries()) {
    weightedBytesOut[lang] = Math.round(bytes);
  }

  const commitShareOut = {};
  for (const [lang, count] of commitShare.entries()) {
    commitShareOut[lang] = Math.round(count * 100) / 100; // 2 decimal places
  }

  return {
    weightedBytes: weightedBytesOut,
    commitShare: commitShareOut,
    version: LANGUAGE_OUTPUT_VERSION,
  };
}

/**
 * Compute language aggregation for a single repository.
 */
function computeRepoLanguageAggregation({ commits = [], languageSnapshots = [], repoId } = {}) {
  return computeLanguageAggregation({ commits, languageSnapshots, repoFilter: { repoId } });
}

module.exports = {
  LANGUAGE_OUTPUT_VERSION,
  computeLanguageAggregation,
  computeRepoLanguageAggregation,
};
