/**
 * WebhookDelivery model (T7.1) — persisted delivery-ID dedupe ledger.
 *
 * prd.md §17 requires "event dedupe by delivery ID"; race-safe dedupe needs
 * a unique DB constraint (an in-memory Set would break across restarts and
 * concurrent workers), so this collection records one row per processed
 * GitHub delivery. The unique index on `deliveryId` is the race-safe gate:
 * concurrent duplicate deliveries lose the create race (duplicate key
 * error) and are answered 200-deduped without reprocessing.
 *
 * Stores lifecycle metadata ONLY — never the payload, signature, or secret.
 */
const mongoose = require('mongoose');

const webhookDeliverySchema = new mongoose.Schema(
  {
    // X-GitHub-Delivery GUID — the idempotency key.
    deliveryId: { type: String, required: true, trim: true, maxlength: 100 },
    // Allowlisted event type at processing time ('push' | 'pull_request' | 'issues' | 'ping').
    event: { type: String, required: true, trim: true, maxlength: 40 },
  },
  {
    timestamps: true,
    bufferCommands: false,
  }
);

// Race-safe dedupe: MongoDB rejects the second insert of the same delivery.
webhookDeliverySchema.index({ deliveryId: 1 }, { unique: true });

const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema);

module.exports = WebhookDelivery;
