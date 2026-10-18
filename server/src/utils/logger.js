/**
 * Structured JSON logger (pino). The ONLY logging mechanism on the backend
 * (rules.md §13). Never log tokens, secrets, cookies, or diffs.
 */
const pino = require('pino');

const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info',
});

/**
 * Safe error-log fields for failure paths (rules.md §11/§13, T8.2 logging
 * hygiene). Raw `err.message` may embed driver/connection details (e.g. a
 * Mongo URI with credentials) or provider responses, so it is never logged;
 * callers keep the safe identifiers they already have (reqId/jobId/userId)
 * and add `{ ...safeErrorMeta(err, 'operation-name') }`.
 * @param {unknown} err the caught error (may be anything)
 * @param {string} operation short name of the failed operation
 * @returns {{ code: string, operation: string }} safe metadata fields
 */
function safeErrorMeta(err, operation) {
  const code = err && typeof err.code === 'string' && err.code.length > 0 ? err.code : 'INTERNAL';
  return { code, operation };
}

module.exports = logger;
module.exports.safeErrorMeta = safeErrorMeta;
