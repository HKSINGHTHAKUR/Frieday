/**
 * Webhook routes (T7.1) — POST /api/webhooks/github.
 *
 * RAW-BODY DESIGN: HMAC-SHA256 must be verified over the EXACT bytes GitHub
 * signed. The global express.json() parser may re-serialize/normalize when
 * parsing, so this router is mounted in app.js BEFORE the global parser and
 * runs its own json parser whose `verify` callback captures the raw buffer
 * (req.rawBody) before parsing. Route-scoped: no global body-parsing change.
 *
 * The webhook is public (no cookie session) — the HMAC signature IS the
 * authentication. No webhook secret configured → 404 WEBHOOKS_V1
 * (architecture.md §5 marker behavior; same safety as AI_ENABLED=false).
 */
const express = require('express');
const { getEnv } = require('../config/env');
const { envelope } = require('../middleware/errorHandler');
const { verifySignature, processVerifiedDelivery, REASONS } = require('../services/webhooks/github.webhooks');

// Captures the exact signed bytes before parsing (see RAW-BODY DESIGN).
const rawBodyParser = express.json({
  limit: '100kb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

/**
 * POST /api/webhooks/github — verify → metadata → dedupe → trusted handler.
 * Invalid/missing signature: 401, zero DB access, zero business processing.
 */
async function githubWebhookHandler(req, res) {
  const config = req.deps?.config ?? getEnv();
  if (!config.WEBHOOK_SECRET) {
    return res
      .status(404)
      .json(envelope({ code: 'WEBHOOKS_V1', message: 'Webhooks are not configured.', retryable: false }));
  }

  const signature = req.get('x-hub-signature-256');
  const verification = verifySignature({
    secret: config.WEBHOOK_SECRET,
    rawBody: req.rawBody,
    signatureHeader: signature,
  });
  if (!verification.verified) {
    // P0: unverified input must never reach the DB or any handler. Log only
    // the failure reason class — never the signature or payload.
    req.log.warn({ reqId: req.id, result: 'rejected', reason: verification.reason });
    return res
      .status(401)
      .json(envelope({ code: 'UNAUTHENTICATED', message: 'Invalid webhook signature.', retryable: false }));
  }

  const event = req.get('x-github-event');
  const deliveryId = req.get('x-github-delivery');
  if (!deliveryId || typeof deliveryId !== 'string' || deliveryId.length > 100) {
    req.log.warn({ reqId: req.id, result: 'rejected', reason: 'missing-delivery-id' });
    return res
      .status(400)
      .json(
        envelope({ code: 'VALIDATION_ERROR', message: 'Missing or invalid delivery id.', retryable: false })
      );
  }
  if (!event || typeof event !== 'string' || event.length > 40) {
    req.log.warn({ reqId: req.id, result: 'rejected', reason: 'missing-event' });
    return res
      .status(400)
      .json(
        envelope({ code: 'VALIDATION_ERROR', message: 'Missing or invalid event header.', retryable: false })
      );
  }

  const result = await processVerifiedDelivery({
    deps: req.deps ?? {},
    event,
    deliveryId,
    payload: req.body,
    log: req.log,
  });
  return res.status(result.status).json(result.body);
}

/**
 * Factory form for tests (fake store/handler/config); the default export is
 * the production router (same convention as insights.routes).
 * @param {{ deliveryStore?: object, handleEvent?: Function, config?: object }} [deps]
 */
function createWebhooksRouter(deps = {}) {
  const router = express.Router();
  router.use((req, _res, next) => {
    req.deps = deps;
    next();
  });
  router.post('/github', rawBodyParser, (req, res, next) => {
    githubWebhookHandler(req, res).catch(next);
  });
  return router;
}

module.exports = createWebhooksRouter();
module.exports.createWebhooksRouter = createWebhooksRouter;
module.exports.REASONS = REASONS;
