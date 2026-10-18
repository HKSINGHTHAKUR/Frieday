# GitHub Webhook Setup (T7.1) + Incremental Ingest (T7.2)

Frieday accepts GitHub webhooks at `POST /api/webhooks/github` to keep repository data fresh without manual syncs (prd.md §17, FR-13; architecture.md §9).

## Receiver behavior

| Step                                            | Behavior                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Signature missing / malformed / invalid         | `401` error envelope — no DB access, no processing                                                         |
| Missing `X-GitHub-Delivery` or `X-GitHub-Event` | `400` error envelope                                                                                       |
| Event not in allowlist (signed)                 | `200 { received: true, ignored: true }` — nothing stored                                                   |
| `ping`                                          | `200 { received: true, pong: true }` — never triggers ingestion (T7.1 behavior)                            |
| Duplicate delivery ID                           | `200 { received: true, deduped: true }` — processed once                                                   |
| `push` / `pull_request` / `issues`              | `200 { received: true, event, deduped: false }` → trusted-handler boundary → **incremental ingest (T7.2)** |

Verification is HMAC-SHA256 over the **exact raw request bytes** using the shared webhook secret, compared timing-safely. Unverified payloads never reach the database or any business handler (T7.1 P0; regression-tested).

## Incremental ingest (T7.2)

After the T7.1 boundary (HMAC → metadata → allowlist → shape validation → dedupe), a `push`/`pull_request`/`issues` event is mapped to **incremental ingest** for the affected repository:

1. **Repository resolution.** The event's `repository.id` (GitHub ID) is resolved through the existing user-scoped `Repository` model. Every row matching the ID identifies an owning user; each owner gets their own single-repo ingest. **No payload `userId` is ever trusted** — only the persisted ownership relationship maps a repo to a user. A repo with no connected user is safely skipped (`skipped-unmapped`, logged, no records created).
2. **Stale-event guard.** The newest verified GitHub timestamp in the event (repository `updated_at`, plus `pull_request.updated_at` / `issue.updated_at`) is compared to the repository's persisted `githubUpdatedAt`. If it is **at or before** the persisted boundary the event is ignored (`skipped-stale`): it cannot add newer data and must not regress state. Missing timestamps ⇒ cannot classify ⇒ eligible (the T3.2 newer-wins persistence still prevents any regression).
3. **Single-repo ingest, `since = lastSyncedAt`.** The run claims the existing per-user single-flight job (`kind: 'incremental'`, the SyncJob partial unique index). If any sync (manual, webhook, or scheduler) is already active for the user, the event is skipped (`conflict`) — no competing sync ever starts. The fetch targets **only the affected repository** with `since = Repository.lastSyncedAt` passed through the existing fetchers (commits/issues use GitHub's `since`; pulls filter + stop at the boundary since the pulls endpoint has no `since`; languages refetch the single snapshot). No roster refetch, no full user sync.
4. **Persistence + boundary.** Fetched DTOs go through the existing normalization/persistence (guarded newer-wins upserts). On success the per-repo `Repository.lastSyncedAt` boundary advances, so the next webhook for the same repo is incremental from the new point. Full-sync SyncState cursor envelopes are left untouched.
5. **Failure semantics.** 401/403 → `UNAUTHENTICATED`; 429/exhausted-403 → `RATE_LIMITED` + `resumeAt`; 404 → `NOT_FOUND` (repo no longer accessible); 5xx/network → `GITHUB_UNREACHABLE`. Runs end honestly (`failed` job with typed code), prior good data is kept, and a webhook failure is not silently converted to success. Because delivery dedupe happens before ingest, a failed ingest is not replayed by GitHub retries — the 6-hour scheduler is the backstop.

**Freshness (target: p95 < 5 min).** Each run logs `webhook freshness` with `receivedAt` (trusted boundary) → `startedAt` (claim) → `completedAt` (run terminal) and `durationMs`. The p95 target is only meaningful against a live GitHub/Mongo deployment; unit tests verify the measurement path (deterministic `computeFreshnessMs`), not the production latency.

## Configuration

The secret is read from server-side env only (`server/src/config/env.js`):

```env
WEBHOOK_SECRET=<same value you enter in the GitHub webhook settings>
```

- Leave `WEBHOOK_SECRET` empty to disable the endpoint entirely (it returns `404 WEBHOOKS_V1`).
- Never commit the real secret; never expose it to the frontend (it lives only in the server process).

The **scheduler fallback** (tasks.md T7.2) is enabled with `SCHEDULER_ENABLED=true`; it runs a staggered per-user incremental pass every 6 hours (`server/src/jobs/scheduler.js`) through the same single-flight + rate-limit machinery. It is NOT a queue — BullMQ + Redis remain the documented V1 migration path (architecture.md §16) and are not implemented.

## GitHub webhook setup (repository or organization)

1. GitHub → **Settings → Webhooks → Add webhook**.
2. **Payload URL**: your Frieday server's `https://<host>/api/webhooks/github`
   (local development: use a tunnel such as `ngrok http 5000` or `smee.io` and append `/api/webhooks/github`; there is no public production URL in this repository — use your own deployment host).
3. **Content type**: `application/json` (required — the signature is computed over the raw JSON bytes).
4. **Secret**: the same value as `WEBHOOK_SECRET` in the server environment.
5. **SSL verification**: enabled (HTTPS URL required).
6. **Events** ("Let me select individual events"):
   - `Pushes` (`push`)
   - `Pull requests` (`pull_request`)
   - `Issues` (`issues`)
   - `Ping` is delivered automatically on creation — no selection needed.
7. **Active**: checked.

On creation GitHub immediately delivers a `ping` event; a valid response is `{"received":true,"pong":true}`.

## Local development / testing notes

- The endpoint is mounted with a route-scoped JSON parser that captures the raw body before parsing — this is what makes HMAC verification against the exact signed bytes possible.
- To test locally without GitHub, sign a payload yourself:

  ```bash
  BODY='{"zen":"Design for failure.","hook_id":1}'
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | cut -d' ' -f2)
  curl -X POST http://localhost:5000/api/webhooks/github \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: ping" \
    -H "X-GitHub-Delivery: test-delivery-001" \
    -H "X-Hub-Signature-256: sha256=$SIG" \
    -d "$BODY"
  ```

- Delivery dedupe is persisted (unique index on the delivery ID in `webhookdeliveries`), so restarts and concurrent duplicates stay safe.
- Full payload/log inspection is intentionally absent: the receiver logs only lifecycle metadata (event, delivery ID, request ID, result).
