/**
 * Validated environment configuration (authoritative: architecture.md §17).
 *
 * Rules (rules.md §10):
 * - Only module allowed to read `process.env` directly.
 * - Fail fast at boot with a named error (`Missing env: X`).
 */
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  MONGO_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/frieday'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  // architecture.md §13: AES-256-GCM requires exactly 32 bytes → 64 hex characters.
  TOKEN_ENC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENC_KEY must be 64 hex characters (32 bytes)'),

  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  GITHUB_SCOPES: z.string().default('read:user repo'),
  GITHUB_CALLBACK_URL: z.string().default('http://localhost:5000/api/auth/github/callback'),
  // Production must never fall back to a localhost callback: GitHub rejects
  // the authorization request with "The redirect_uri is not associated with
  // this application", which surfaces to the user as a broken sign-in. A
  // localhost callback in production is always a misconfiguration, so it is
  // rejected at boot (see `assertNoLocalhostCallback` below) rather than
  // silently accepted.
  // Endpoint overrides exist for local dev / CI test doubles only
  // (T1.1 acceptance: "mocked token endpoint, no live GitHub in CI").
  GITHUB_TOKEN_URL: z.string().url().default('https://github.com/login/oauth/access_token'),
  GITHUB_API_USER_URL: z.string().url().default('https://api.github.com/user'),
  // Base URL for GitHub REST calls (T1.2 grant revocation); test-double override only.
  GITHUB_API_BASE: z.string().url().default('https://api.github.com'),

  // architecture.md §8/§17: concurrency cap for GitHub requests during a sync.
  SYNC_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  SYNC_MAX_REPOS: z.coerce.number().int().positive().default(100),
  SYNC_MAX_COMMITS_PER_REPO: z.coerce.number().int().positive().default(500),
  SYNC_MAX_PRS_PER_REPO: z.coerce.number().int().positive().default(300),
  SYNC_MAX_ISSUES_PER_REPO: z.coerce.number().int().positive().default(300),

  SCHEDULER_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  AI_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  AI_PROVIDER: z.string().default(''),
  AI_MODEL: z.string().default(''),
  AI_BASE_URL: z.string().default(''),
  // prd.md §19: "Model name, base URL, API key via env." Secret: never
  // logged, returned, or embedded in errors (rules.md §10).
  AI_API_KEY: z.string().default(''),
  WEBHOOK_SECRET: z.string().default(''),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const REQUIRED_ENV_VARS = ['JWT_SECRET', 'TOKEN_ENC_KEY'];

/**
 * Whether a URL points at the local machine.
 * @param {string} url
 * @returns {boolean}
 */
function isLocalhostUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Guard against a production deployment resolving to a localhost callback.
 *
 * In production the GitHub OAuth callback MUST be the public origin. If it
 * is left at the local-development default, GitHub answers the authorization
 * request with "The redirect_uri is not associated with this application" and
 * the user cannot sign in. Failing at boot makes the misconfiguration obvious
 * instead of shipping it.
 *
 * @param {z.infer<typeof envSchema>} env the validated config
 * @throws {Error} named `Invalid env: GITHUB_CALLBACK_URL — ...`
 */
function assertNoLocalhostCallback(env) {
  if (env.NODE_ENV !== 'production') return;
  if (!isLocalhostUrl(env.GITHUB_CALLBACK_URL)) return;
  throw new Error(
    'Invalid env: GITHUB_CALLBACK_URL — must be the public production origin in production ' +
      '(e.g. https://frieday.onrender.com/api/auth/github/callback), not a localhost URL'
  );
}

/**
 * Validate a raw env object. Pure/testable — pass a fake object in tests.
 * @param {NodeJS.ProcessEnv} [source] raw env (defaults to process.env)
 * @returns {z.infer<typeof envSchema>} validated config
 * @throws {Error} named `Missing env: <NAME>` or `Invalid env: <NAME> ...`
 */
function loadEnv(source = process.env) {
  for (const name of REQUIRED_ENV_VARS) {
    const value = source[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing env: ${name}`);
    }
  }
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const name = Array.isArray(first.path) && first.path.length > 0 ? first.path.join('.') : 'env';
    throw new Error(`Invalid env: ${name} — ${first.message}`);
  }
  assertNoLocalhostCallback(parsed.data);
  return parsed.data;
}

let cached = null;

/**
 * Boot-time accessor. Validates once, caches afterwards.
 * @returns {z.infer<typeof envSchema>}
 */
function getEnv() {
  if (!cached) {
    cached = loadEnv(process.env);
  }
  return cached;
}

module.exports = { loadEnv, getEnv, REQUIRED_ENV_VARS, isLocalhostUrl, assertNoLocalhostCallback };
