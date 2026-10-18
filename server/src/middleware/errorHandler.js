/**
 * Central error handler. Enforces the error envelope (architecture.md §5):
 *   { error: { code, message, details?, retryable } }
 * Unknown errors → 500 + logged with request ID; never leak stacks/tokens.
 */

const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SYNC_CONFLICT: 409,
  RATE_LIMITED: 429,
  GITHUB_UNREACHABLE: 502,
  AI_DISABLED: 501,
  WEBHOOKS_V1: 404,
  INTERNAL: 500,
};

/**
 * Build an error envelope payload (no response sent).
 * @param {{ code?: string, message?: string, details?: unknown, retryable?: boolean }} parts
 */
function envelope(parts = {}) {
  const { code = 'INTERNAL', message = 'Something went wrong.', details, retryable = false } = parts;
  const payload = { error: { code, message, retryable } };
  if (details !== undefined) {
    payload.error.details = details;
  }
  return payload;
}

// Express selects this handler by its 4-argument arity; `_next` is intentionally unused.
function errorHandler(err, req, res, _next) {
  const code = err && err.code && STATUS_BY_CODE[err.code] ? err.code : 'INTERNAL';
  const status = err && Number.isInteger(err.status) ? err.status : STATUS_BY_CODE[code];
  const retryable = Boolean(err && err.retryable);

  if (code === 'INTERNAL') {
    // err.message may embed driver/connection details — log safe metadata only.
    req.log.error({ reqId: req.id, code, operation: 'unhandled-error' });
  } else {
    req.log.warn({ reqId: req.id, code, operation: 'handled-error' });
  }

  const message = code === 'INTERNAL' ? 'Something went wrong.' : err.message;
  res.status(status).json(envelope({ code, message, details: err.details, retryable }));
}

/**
 * 404 catch-all for unknown routes — same envelope shape.
 */
function notFound(req, res) {
  res.status(404).json(
    envelope({
      code: 'NOT_FOUND',
      message: `Not found: ${req.method} ${req.path}`,
      retryable: false,
    })
  );
}

module.exports = { errorHandler, notFound, envelope, STATUS_BY_CODE };
