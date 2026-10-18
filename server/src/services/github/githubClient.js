/**
 * Per-user GitHub API client (architecture.md §8, tasks.md T2.1).
 *
 * Security contract (rules.md §7/§13, prd.md §21): the GitHub access token is
 * read from the encrypted user record, decrypted server-side, and held in
 * memory ONLY inside the Octokit instance. It is never returned, persisted,
 * or logged, and this module exposes no way to read it back.
 *
 * Every request runs through the shared rate-limit gate (architecture.md §8:
 * "All fetchers go through this gate"), which enforces the validated
 * SYNC_CONCURRENCY cap and GitHub 403/429 backoff with resume times.
 *
 * Dependency rationale (rules.md §16): @octokit/rest is mandated by
 * architecture.md §8 ("Octokit instance factory") and prd.md §17 ("Octokit
 * REST in MVP") — pagination/cursor handling + typed rate-limit errors.
 * Server-only; zero client bundle impact.
 *
 * The Phase 1 fetch-based flows (OAuth exchange, grant revocation) remain
 * untouched — architecture.md §8 explicitly exempts the pre-user-token paths.
 */
const { Octokit } = require('@octokit/rest');
const { getEnv } = require('../../config/env');
const { getGithubConfig } = require('../../config/github');
const { decryptToken } = require('../auth/crypto.service');
const { createRateLimitGate } = require('./rateLimit');

// One gate per process: the concurrency cap and cooldown are shared by all
// of a user's fetchers (architecture.md §8: per-sync concurrency ≤ N).
let sharedGate = null;

/** @returns the process-wide rate-limit gate (lazy, env-validated concurrency). */
function getSharedGate() {
  if (!sharedGate) {
    sharedGate = createRateLimitGate({ concurrency: getEnv().SYNC_CONCURRENCY });
  }
  return sharedGate;
}

/**
 * Map a non-rate-limited GitHub HTTP failure to the documented error codes
 * (architecture.md §5). Messages never carry credentials.
 * @param {{ status: number, error?: unknown }} result
 * @returns {Error}
 */
function githubErrorFor(result) {
  let err = result.error;
  if (!(err instanceof Error)) {
    err = new Error(`GitHub API request failed with status ${result.status}`);
  }
  const status = result.status;
  let code;
  let retryable;
  if (status === 401 || status === 403) {
    code = 'UNAUTHENTICATED';
    retryable = false; // revoked/denied token: reconnect required
  } else if (status === 404) {
    code = 'NOT_FOUND';
    retryable = false;
  } else if (status >= 500) {
    code = 'GITHUB_UNREACHABLE';
    retryable = true;
  } else {
    code = 'GITHUB_UNREACHABLE';
    retryable = false;
  }
  err.code = err.code ?? code;
  err.retryable = err.retryable ?? retryable;
  return err;
}

/**
 * @param {{ githubTokenEnc: string }} userDoc authenticated user record
 *   (from the User model; `githubTokenEnc` is the AES-256-GCM payload)
 * @param {{
 *   gate?: object,
 *   OctokitImpl?: typeof Octokit,
 *   githubConfig?: { apiBase: string },
 * }} [deps] test seams (injected gate / Octokit impl / endpoint base)
 * @returns {{
 *   gate: object,
 *   request: (route: string, parameters?: object) => Promise<any>,
 *   requestWithHeaders: (route: string, parameters?: object) => Promise<{ data: any, headers: object, status: number }>,
 * }}
 */
function createGithubClient(userDoc, { gate, OctokitImpl = Octokit, githubConfig = getGithubConfig() } = {}) {
  if (!userDoc || typeof userDoc.githubTokenEnc !== 'string') {
    const err = new Error('A stored encrypted GitHub token is required.');
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  const token = decryptToken(userDoc.githubTokenEnc); // memory-only from here on
  const activeGate = gate ?? getSharedGate();
  const octokit = new OctokitImpl({
    auth: token,
    baseUrl: githubConfig.apiBase,
  });

  /**
   * Run one gated attempt and return the raw result (shared by request and
   * requestWithHeaders so both go through the identical gate + error path).
   * @param {string} route Octokit route, e.g. `'GET /user/repos'`
   * @param {object} [parameters] query/path parameters (`per_page`, `page`, …)
   * @returns {Promise<{ status: number, headers: object, data?: any, error?: unknown }>}
   */
  async function runRaw(route, parameters = {}) {
    return activeGate.run(async () => {
      try {
        const res = await octokit.request(route, parameters);
        return { status: res.status, headers: res.headers, data: res.data };
      } catch (err) {
        // Octokit rejects non-2xx with a RequestError carrying `.status` and
        // the full HTTP response (`.response.headers`) — the gate needs the
        // rate-limit headers to decide whether to back off.
        const status = err?.status;
        const headers = err?.response?.headers ?? err?.headers;
        if (Number.isInteger(status) && status >= 400 && headers) {
          return { status, headers, error: err };
        }
        throw err; // network-level failure: not a rate limit — propagate
      }
    });
  }

  /**
   * Perform one GitHub REST request through the rate-limit gate.
   * @param {string} route Octokit route, e.g. `'GET /user/repos'`
   * @param {object} [parameters] query/path parameters (`per_page`, `page`, …)
   * @returns {Promise<any>} the parsed response body (rate-limit retries
   *   already applied by the gate)
   * @throws {RateLimitedError} `RATE_LIMITED` with `resumeAt` when the limit
   *   cannot be resumed within the gate horizon
   * @throws {Error} typed error (UNAUTHENTICATED / NOT_FOUND / GITHUB_UNREACHABLE)
   */
  async function request(route, parameters = {}) {
    const result = await runRaw(route, parameters);
    if (result.status >= 400) {
      throw githubErrorFor(result);
    }
    return result.data;
  }

  /**
   * Same as `request`, but additionally returns the response headers and
   * status (T2.2: fetchers need the `Link` header for pagination). Gate,
   * retries, and error mapping are identical to `request`.
   * @param {string} route Octokit route, e.g. `'GET /user/repos'`
   * @param {object} [parameters] query/path parameters (`per_page`, `page`, …)
   * @returns {Promise<{ data: any, headers: object, status: number }>}
   * @throws {RateLimitedError} `RATE_LIMITED` with `resumeAt` when the limit
   *   cannot be resumed within the gate horizon
   * @throws {Error} typed error (UNAUTHENTICATED / NOT_FOUND / GITHUB_UNREACHABLE)
   */
  async function requestWithHeaders(route, parameters = {}) {
    const result = await runRaw(route, parameters);
    if (result.status >= 400) {
      throw githubErrorFor(result);
    }
    return { data: result.data, headers: result.headers ?? {}, status: result.status };
  }

  return {
    gate: activeGate,
    request,
    requestWithHeaders,
  };
}

module.exports = { createGithubClient, getSharedGate };
