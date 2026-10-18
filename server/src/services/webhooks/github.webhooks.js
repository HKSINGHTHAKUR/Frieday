/**
 * GitHub webhook service (T7.1, architecture.md §9/§11, prd.md §17).
 *
 * Receiver boundary — untrusted HTTP never reaches business logic until it
 * has passed: raw body → HMAC-SHA256 → metadata → allowlist → payload
 * validation → delivery dedupe → trusted handler. The trusted handler is a
 * small injected boundary; T7.2 maps it to incremental ingest
 * (single-repo, since=lastSyncedAt, timestamp-guarded).
 *
 * Logging carries lifecycle metadata only (event, deliveryId, reqId,
 * result) — never payloads, signatures, or secrets (rules.md §13).
 */
const crypto = require('node:crypto');
const { z } = require('zod');
const WebhookDelivery = require('../../models/WebhookDelivery');
const { envelope } = require('../../middleware/errorHandler');
const { triggerIncrementalIngest } = require('../ingestion/incremental.trigger');

/** Event allowlist (prd.md §17): everything else is signed-but-ignored. */
const EVENT_ALLOWLIST = ['push', 'pull_request', 'issues', 'ping'];

const REASONS = {
  BAD_SIGNATURE: 'BAD_SIGNATURE',
  MISSING_SIGNATURE: 'MISSING_SIGNATURE',
  MALFORMED_SIGNATURE: 'MALFORMED_SIGNATURE',
};

// Minimal routing shapes only (T7.1) — T7.2 adds OPTIONAL GitHub timestamps
// (repository.updated_at / pull_request.updated_at / issue.updated_at) that
// the stale-event guard needs. All additive: a payload without them still
// validates and routes exactly as before. zod strips unknown keys, so GitHub's
// many extra fields never propagate.
const timestampField = z.string().max(40).optional();
const repositoryShape = z.object({
  id: z.number().int(),
  full_name: z.string().max(300),
  updated_at: timestampField,
});
const EVENT_SHAPES = {
  push: z.object({
    repository: repositoryShape,
    ref: z.string().max(200).optional(),
    after: z.string().max(60).optional(),
  }),
  pull_request: z.object({
    action: z.string().max(40),
    repository: repositoryShape,
    pull_request: z.object({ id: z.number().int(), number: z.number().int(), updated_at: timestampField }),
  }),
  issues: z.object({
    action: z.string().max(40),
    repository: repositoryShape,
    issue: z.object({ id: z.number().int(), number: z.number().int(), updated_at: timestampField }),
  }),
  ping: z.object({ zen: z.string().max(200), hook_id: z.number().int().optional() }),
};

/**
 * Timing-safe HMAC-SHA256 verification over the EXACT raw request bytes
 * GitHub signed. Length mismatches (bad hex, wrong prefix) fail fast without
 * leaking the expected value.
 * @param {{ secret: string, rawBody: Buffer, signatureHeader: string | undefined }} parts
 * @returns {{ verified: boolean, reason?: string }}
 */
function verifySignature({ secret, rawBody, signatureHeader }) {
  if (!secret) return { verified: false, reason: REASONS.MISSING_SIGNATURE };
  if (!Buffer.isBuffer(rawBody)) return { verified: false, reason: REASONS.MISSING_SIGNATURE };
  if (typeof signatureHeader !== 'string' || signatureHeader.length === 0) {
    return { verified: false, reason: REASONS.MISSING_SIGNATURE };
  }
  if (!signatureHeader.startsWith('sha256=')) {
    return { verified: false, reason: REASONS.MALFORMED_SIGNATURE };
  }
  const provided = signatureHeader.slice('sha256='.length);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length || providedBuf.length === 0) {
    return { verified: false, reason: REASONS.MALFORMED_SIGNATURE };
  }
  const verified = crypto.timingSafeEqual(expectedBuf, providedBuf);
  return { verified, reason: verified ? undefined : REASONS.BAD_SIGNATURE };
}

/**
 * Race-safe delivery dedupe (unique index on deliveryId). Returns
 * 'recorded' for the first delivery, 'duplicate' when the unique constraint
 * rejects a concurrent/replayed delivery.
 * @param {{ deliveryId: string, event: string }} parts
 * @returns {Promise<'recorded'|'duplicate'>}
 */
async function recordDelivery({ deliveryId, event }) {
  try {
    await WebhookDelivery.create({ deliveryId, event });
    return 'recorded';
  } catch (err) {
    if (err && err.code === 11000) return 'duplicate';
    throw err;
  }
}

/**
 * Default trusted-event boundary (T7.1 + T7.2). T7.2 connects the verified
 * trusted event to incremental ingest (architecture.md §9): the handler passes
 * the trusted event onward → triggerIncrementalIngest (single-repo, since =
 * lastSyncedAt, timestamp-guarded). No unverified payload can reach it.
 * `deps` (route-injected, test seams) is forwarded so ingest can be tested
 * without MongoDB/GitHub.
 * @param {{ event: string, deliveryId: string, repository?: object, action?: string, payload?: object, receivedAt?: number, log?: object, deps?: object }} trustedEvent
 */
async function defaultHandleEvent(trustedEvent) {
  return triggerIncrementalIngest(trustedEvent, trustedEvent.deps ?? {});
}

/**
 * Process a signature-verified delivery: allowlist → shape validation →
 * dedupe → trusted handler. Returns the HTTP result; never throws for
 * expected security/validation outcomes.
 * @param {{ deps: object, event: string, deliveryId: string, payload: object, log: object }} parts
 */
async function processVerifiedDelivery({ deps, event, deliveryId, payload, log }) {
  const handleEvent = deps.handleEvent ?? defaultHandleEvent;
  const deliveryStore = deps.deliveryStore ?? { recordDelivery };

  if (event === 'ping') {
    const parsed = EVENT_SHAPES.ping.safeParse(payload);
    if (!parsed.success) {
      return {
        status: 400,
        body: envelope({ code: 'VALIDATION_ERROR', message: 'Malformed webhook ping payload.' }),
      };
    }
    log.info({ event, deliveryId, result: 'pong' });
    return { status: 200, body: { received: true, pong: true } };
  }

  if (!EVENT_ALLOWLIST.includes(event)) {
    // Signed but not allowlisted: ignore safely, touch nothing.
    log.warn({ event, deliveryId, result: 'ignored-unknown-event' });
    return { status: 200, body: { received: true, ignored: true } };
  }

  const parsed = EVENT_SHAPES[event].safeParse(payload);
  if (!parsed.success) {
    log.warn({ event, deliveryId, result: 'rejected-shape' });
    return {
      status: 400,
      body: envelope({ code: 'VALIDATION_ERROR', message: `Malformed ${event} payload.` }),
    };
  }

  const dedupe = await deliveryStore.recordDelivery({ deliveryId, event });
  if (dedupe === 'duplicate') {
    log.info({ event, deliveryId, result: 'deduped' });
    return { status: 200, body: { received: true, deduped: true } };
  }

  await handleEvent({
    event,
    deliveryId,
    repository: parsed.data.repository,
    action: parsed.data.action,
    payload: parsed.data,
    receivedAt: Date.now(),
    log,
    deps,
  });
  log.info({ event, deliveryId, result: 'accepted' });
  return { status: 200, body: { received: true, event, deduped: false } };
}

module.exports = {
  EVENT_ALLOWLIST,
  REASONS,
  EVENT_SHAPES,
  verifySignature,
  recordDelivery,
  defaultHandleEvent,
  processVerifiedDelivery,
};
