/**
 * GitHub OAuth + API configuration (architecture.md §4, §7).
 * Values come from validated env (config/env.js) — no direct process.env reads.
 */
const { getEnv } = require('./env');

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/**
 * @returns {{ clientId: string, clientSecret: string, scopes: string, callbackUrl: string, authorizeUrl: string, tokenUrl: string, userApiUrl: string, apiBase: string }}
 */
function getGithubConfig() {
  const env = getEnv();
  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    scopes: env.GITHUB_SCOPES,
    callbackUrl: env.GITHUB_CALLBACK_URL,
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: env.GITHUB_TOKEN_URL,
    userApiUrl: env.GITHUB_API_USER_URL,
    apiBase: env.GITHUB_API_BASE,
  };
}

/**
 * Whether the OAuth App is configured (used by the health endpoint — no network call).
 * @returns {'configured'|'unconfigured'}
 */
function configStatus() {
  return getGithubConfig().clientId ? 'configured' : 'unconfigured';
}

module.exports = { getGithubConfig, configStatus, AUTHORIZE_URL };
