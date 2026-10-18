/**
 * Languages fetcher (T2.2).
 *
 * Fetches repository language statistics (bytes per language) for repositories.
 *
 * Returns DTOs ready for normalization layer.
 */

const { createGithubClient } = require('./githubClient');
const { createProvenance, fetcherErrorFor } = require('./fetcherUtils');

/**
 * Normalize a raw GitHub languages object to a DTO.
 * GitHub returns: { "JavaScript": 12345, "TypeScript": 6789 }
 * We convert to array of { language, bytes } objects.
 * @param {object} languages - Raw languages from GitHub API
 * @param {string} repoId - Repository ID (MongoDB ObjectId as string)
 * @param {object} provenance - Provenance metadata
 * @returns {object} Normalized language snapshot DTO
 */
function normalizeLanguages(languages, repoId, provenance) {
  if (!languages || typeof languages !== 'object') {
    return { repoId, languages: [], totalBytes: 0, ...provenance };
  }

  const entries = Object.entries(languages);
  const languageArray = entries.map(([language, bytes]) => ({
    language,
    bytes: typeof bytes === 'number' ? bytes : 0,
  }));

  const totalBytes = languageArray.reduce((sum, l) => sum + l.bytes, 0);

  return {
    repoId,
    languages: languageArray,
    totalBytes,
    ...provenance,
  };
}

/**
 * Fetch languages for a single repository.
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} repoId - MongoDB repository ID (string)
 * @param {object} [options] - Fetch options
 * @param {string} [options.etag] - Cached ETag from SyncState.cursor; sent as
 *   `If-None-Match` for a conditional request
 * @param {object} [options.client] - Injected GitHub client (test seam; any
 *   other keys are forwarded to the client factory)
 * @returns {Promise<object|null>} Normalized language snapshot DTO, or null
 *   when there is nothing to store (not found, or 304 Not Modified meaning
 *   the cached snapshot is still current)
 */
async function fetchLanguages(userDoc, owner, repo, repoId, { etag = null, ...deps } = {}) {
  const client = deps.client ?? createGithubClient(userDoc, deps);
  try {
    const params = { owner, repo };
    if (etag) params.headers = { 'If-None-Match': etag };
    const response = await client.request('GET /repos/{owner}/{repo}/languages', params);
    return normalizeLanguages(response, repoId, createProvenance('rest'));
  } catch (err) {
    if (err.status === 404 || err.code === 'NOT_FOUND') {
      return null;
    }
    // 304 Not Modified (Octokit throws; githubClient passes it through raw
    // because it is not an error status): cached data is still current.
    if (err?.status === 304) {
      return null;
    }
    // Typed errors (rate-limit exhaustion, auth, unreachable) pass through;
    // raw transport failures are wrapped so callers always see code+retryable.
    if (err instanceof Error && err.code) {
      throw err;
    }
    throw fetcherErrorFor(500, {
      message: err.message,
      details: { originalError: err.name },
      retryable: true,
    });
  }
}

/**
 * Fetch languages for multiple repositories.
 * This is a per-repo endpoint, so we fetch sequentially.
 * @param {object} userDoc - User document with encrypted GitHub token
 * @param {Array} repositories - Array of { owner, name, repoId }
 * @param {object} [options] - Fetch options
 * @param {Map} [options.cursors] - Per-repo SyncState cursors (`owner/name`
 *   → cursor); a cursor's `etag` is sent as `If-None-Match`
 * @param {object} [options.client] - Injected GitHub client (test seam)
 * @param {(info: { key: string, index: number, total: number }) => void} [options.onProgress]
 *   Optional per-repository completion callback (T2.3: progress tracking).
 *   Failures inside the callback propagate (they indicate a broken observer).
 * @returns {Promise<{ languageSnapshots: Array, errors: Map }>}
 */
async function fetchLanguagesForRepositories(
  userDoc,
  repositories,
  { cursors = null, onProgress = null, ...deps } = {}
) {
  const languageSnapshots = [];
  const errors = new Map();

  let index = 0;
  for (const repo of repositories) {
    const key = `${repo.owner}/${repo.name}`;
    try {
      const etag = cursors?.get(key)?.etag ?? null;
      const snapshot = await fetchLanguages(userDoc, repo.owner, repo.name, repo.repoId, { etag, ...deps });
      if (onProgress) await onProgress({ key, index, total: repositories.length });
      if (snapshot) {
        languageSnapshots.push(snapshot);
      } else {
        // No snapshot and no throw means "nothing to store" (404 skip or
        // 304 unchanged): record it so the absence is visible, not silent.
        errors.set(key, {
          message: 'No language data stored for this repository (not found or unchanged).',
          code: 'NOT_FOUND',
          status: 404,
        });
      }
    } catch (err) {
      // Log error but continue with other repos
      errors.set(key, {
        message: err.message,
        code: err.code,
        status: err.status,
      });
    }
    index += 1;
  }

  return { languageSnapshots, errors };
}

module.exports = {
  fetchLanguages,
  fetchLanguagesForRepositories,
  normalizeLanguages,
};
