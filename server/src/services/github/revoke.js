/**
 * GitHub grant revocation (architecture.md §5: disconnect = "revoke GitHub
 * token (best-effort) + clear stored token"). All GitHub calls live in
 * services/github/ (architecture.md §1.2, rules.md §11).
 */
const { getGithubConfig } = require('../../config/github');

/**
 * Revoke the user's OAuth grant for the OAuth App (DELETE /applications/:id/grant).
 * @param {string} accessToken
 * @returns {Promise<boolean>} true when GitHub confirmed the revocation
 * @throws {Error} code `GITHUB_UNREACHABLE` on network/HTTP failure
 */
async function revokeGrant(accessToken) {
  const gh = getGithubConfig();
  const res = await fetch(`${gh.apiBase}/applications/${encodeURIComponent(gh.clientId)}/grant`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Frieday',
    },
  });
  if (!res.ok) {
    const err = new Error(`GitHub grant revocation failed (HTTP ${res.status}).`);
    err.code = 'GITHUB_UNREACHABLE';
    err.retryable = true;
    throw err;
  }
  await res.text();
  return true;
}

module.exports = { revokeGrant };
