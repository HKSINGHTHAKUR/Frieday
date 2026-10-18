/**
 * Request-ID middleware. Attaches `req.id`, echoes `X-Request-Id`.
 * Every log line in request flows MUST include it (rules.md §13).
 */
const { randomUUID } = require('node:crypto');

const HEADER = 'x-request-id';

function requestId(req, res, next) {
  const id = req.headers[HEADER] || randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;
