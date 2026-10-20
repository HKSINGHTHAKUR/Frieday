# Frieday — Operations Runbook (T9.2)

> **Purpose:** incident diagnosis and safe recovery for the production Frieday service.
> **Authoritative companion docs:** `docs/deployment.md`, `md files/architecture.md`, `md files/prd.md`.
> **Production host:** `https://frieday.onrender.com` (Render Free + MongoDB Atlas M0).
>
> **Before acting:** read the full incident section. Identify the cause before attempting recovery. Some actions are safe for operators; others require owner approval and are clearly marked **OWNER APPROVAL REQUIRED**.
>
> **Never:** print, paste, or log secrets, tokens, cookies, or connection strings.

---

## 1. Quick-Reference Health Commands

These commands require only Node.js (no credentials) and are safe to run at any time.

```powershell
# Liveness + DB + GitHub config status
node scripts/smoke.js https://frieday.onrender.com

# Exit-0/1 healthcheck with DB requirement (for monitoring agents)
$env:CHECK_DB="true"; node scripts/healthcheck.js https://frieday.onrender.com

# Raw health JSON (PowerShell)
Invoke-WebRequest -Uri "https://frieday.onrender.com/api/health" -UseBasicParsing |
  Select-Object -ExpandProperty Content

# Security headers
Invoke-WebRequest -Uri "https://frieday.onrender.com/api/health" -UseBasicParsing |
  Select-Object -ExpandProperty Headers
```

Expected healthy response: `{"ok":true,"version":"0.0.0","db":"up","github":"configured","uptime":<N>}` HTTP 200.

**`uptime`** is seconds since the last process start. On Render Free, a low value (< 120s) after a long idle period indicates a recent cold start — not a crash.

---

## 2. Health Failure vs. Authenticated Application Failure

The health endpoint (`GET /api/health`) is unauthenticated and checks three things:

| Field    | `up`/`configured` | `down`/`unconfigured` | What it means                                                                   |
| -------- | ----------------- | --------------------- | ------------------------------------------------------------------------------- |
| `ok`     | `true`            | —                     | Process is running and responding                                               |
| `db`     | `"up"`            | `"down"`              | `mongoose.connection.readyState === 1` (live Mongoose connection)               |
| `github` | `"configured"`    | `"unconfigured"`      | `GITHUB_CLIENT_ID` env var is non-empty at boot (config check, no network call) |

**Health is up but user is getting errors?** The health endpoint does not check:

- Whether the user's GitHub OAuth session is valid.
- Whether a user's sync is running, paused, or errored.
- Whether the MongoDB Atlas cluster can serve queries under load (readyState 1 only proves the connection socket is open).

For authenticated failures, check the structured logs (see §3) and the sync status endpoint (`GET /api/sync/status`) using the browser dev tools on an authenticated session.

---

## 3. Log Inspection Reference

Logs are pino JSON on `stdout`. On Render, view them in the Render dashboard → your service → Logs.

Key log fields:

| Field       | Description                                                      | Example value              |
| ----------- | ---------------------------------------------------------------- | -------------------------- |
| `reqId`     | Per-request UUID (from `requestId.js` middleware)                | `"cdb11814-d0cb-..."`      |
| `jobId`     | Per-sync-job ID (from `SyncJob._id`)                             | `"6714f3a2..."`            |
| `userId`    | MongoDB ObjectId of the acting user                              | `"6714f2c1..."`            |
| `msg`       | Human-readable event description                                 | `"mongodb connected"`      |
| `code`      | Typed error code (see §3.1 below)                                | `"RATE_LIMITED"`           |
| `operation` | Which subsystem produced the log                                 | `"mongodb-retry-schedule"` |
| `level`     | pino level: `10`=trace `20`=debug `30`=info `40`=warn `50`=error | `30`                       |

Default log level: `info` (controlled by `LOG_LEVEL` env var: `debug|info|warn|error`).

### 3.1 Error Codes

| Code                 | HTTP Status | Meaning                                                                        |
| -------------------- | ----------- | ------------------------------------------------------------------------------ |
| `UNAUTHENTICATED`    | 401         | No valid session cookie or GitHub token missing/revoked                        |
| `FORBIDDEN`          | 403         | Authenticated but accessing another user's resource, or OAuth `state` mismatch |
| `NOT_FOUND`          | 404         | Resource does not exist for this user                                          |
| `SYNC_CONFLICT`      | 409         | A sync is already running for this user                                        |
| `RATE_LIMITED`       | 429         | GitHub API rate limit reached; `resumeAt` in response                          |
| `GITHUB_UNREACHABLE` | 502         | GitHub API returned 5xx or network error                                       |
| `AI_DISABLED`        | 501         | AI explanation requested but `AI_ENABLED=false` (MVP default)                  |
| `WEBHOOKS_V1`        | 404         | Webhook endpoint called but `WEBHOOK_SECRET` is empty (disabled)               |
| `INVALID_CONFIG`     | —           | Boot-time env validation failure (logged before process exits)                 |
| `INTERNAL`           | 500         | Unexpected server error; stack never sent to client                            |

---

## 4. Incident: GitHub API Rate Limit (HTTP 403 / 429)

### Symptoms

- Sync shows `RATE_LIMITED` status in `GET /api/sync/status`.
- `resumeAt` field in the sync status response is set to a future timestamp.
- Dashboard KPIs may be stale (showing last-synced data).
- Logs: `warn` entries with `code: "RATE_LIMITED"` or `operation: "rate-limit-gate"`.

### What the system does automatically

The rate-limit gate (`services/github/rateLimit/`) is the only place GitHub requests are made. It:

1. Reads `x-ratelimit-remaining` / `x-ratelimit-reset` / `Retry-After` on every GitHub response.
2. Pauses when remaining drops below 10% of the limit (`LOW_WATERMARK = 0.1`).
3. On 403/429 responses, applies exponential backoff: base 1s, cap 5 min, up to 10 retries (`MAX_RETRIES = 10`), with up to 500ms jitter per attempt.
4. The maximum cooldown within a single sync run is 15 min (`MAX_COOLDOWN_MS`), which matches the 15-minute sync timeout (`SYNC_TIMEOUT_MS`).
5. Concurrency is capped at 2 simultaneous GitHub requests per sync (`DEFAULT_CONCURRENCY = 2`).

If the sync timeout (15 min) is reached while waiting for rate-limit recovery, the job ends with `status: "error"`, `errorCode: "RATE_LIMITED"`, and `resumeAt` set to the GitHub reset time. Prior collected data is kept; the next manual sync or the 6-hour scheduled sync will resume from the stored `since` cursor.

### Safe diagnostic steps

1. Check `GET /api/sync/status` on an authenticated session (browser dev tools → Network tab).
2. Confirm `status: "error"` + `error.code: "RATE_LIMITED"` + `resumeAt` timestamp.
3. The `resumeAt` time is when GitHub rate limits reset (typically within 1 hour).

### Recovery

- **Wait for `resumeAt`**, then trigger "Sync now" from the Settings page. No operator action required.
- If the issue recurs frequently: the per-user GitHub token rate limit is 5,000 requests/hour. Heavy sync accounts (100 repos × 500 commits) approach this. Lowering sync caps via env (`SYNC_MAX_REPOS`, `SYNC_MAX_COMMITS_PER_REPO`) requires a production redeploy — **OWNER APPROVAL REQUIRED**.

### Not a gap — the 6-hour scheduler acts as backstop

If `SCHEDULER_ENABLED=true` (Render env), each user is automatically re-synced every 6 hours. A rate-limited run is not retried within the same tick; the scheduler waits for the next cron fire.

---

## 5. Incident: Revoked GitHub Authorization / Token Invalid

### Symptoms

- User sees "Reconnect" CTA in the dashboard instead of data.
- Sync fails with `UNAUTHENTICATED` status.
- Logs: `warn` with `code: "UNAUTHENTICATED"`, `operation: "background-sync"`.
- `GET /api/auth/me` may return 401 if the refresh token also expired.

### Cause

The user revoked Frieday's OAuth access in GitHub (GitHub → Settings → Applications → Authorized OAuth Apps → Revoke), or the GitHub OAuth token expired/was invalidated by GitHub.

### Safe diagnostic steps

1. Have the affected user open `https://frieday.onrender.com` in a browser.
2. If the session is still active (valid `fd_access`/`fd_refresh` cookies), the dashboard will show the "Reconnect" error state.
3. If the session is also gone, the user will be redirected to the login page.

### Recovery

The user must reconnect:

1. Click "Connect with GitHub" or the "Reconnect" CTA.
2. Complete the OAuth flow.
3. Trigger "Sync now" — GitHub data is re-fetched from scratch (no stale rows are resurrected).

No operator action is required. Token storage is server-side (AES-256-GCM encrypted); no secret values appear in logs.

### If the issue affects all users simultaneously

All users losing GitHub access at once indicates a GitHub-side outage or a `GITHUB_CLIENT_SECRET` / `TOKEN_ENC_KEY` misconfiguration in Render's secret manager. Check `GET /api/health` — `github: "configured"` only confirms `GITHUB_CLIENT_ID` is set, not that the secret is correct. **OWNER APPROVAL REQUIRED** to inspect or rotate Render env vars.

---

## 6. Incident: Sync Stuck, Timed Out, or Partially Failed

### Symptoms

- `GET /api/sync/status` shows `status: "running"` for more than 15–20 minutes.
- Progress counter (`done/total`) has not advanced.
- Or: sync shows `status: "error"` with partial per-resource counts.

### What the system does automatically

- **15-minute timeout:** `SYNC_TIMEOUT_MS = 15 * 60 * 1000`. When the sync orchestrator hits this limit, the job is marked `error` with `message: "Sync timed out. Progress was saved; start a new sync to resume."`. Prior collected data is kept; cursors are checkpointed per-repository.
- **Stale-job reaping:** on the next `POST /api/sync`, `claimActive` checks whether the existing active job is older than `SYNC_TIMEOUT_MS + STALE_GRACE_MS` (15 min + 5 min = 20 min). If so, it is reaped and the new sync starts. Log: `warn` with `msg: "stale sync job reaped"`.
- **Per-repository failure tolerance:** a single repository failing (404, transient GitHub 5xx) does not abort the rest. The error is stored in `SyncState` for that resource; the orchestrator continues with remaining repos.

### Safe diagnostic steps

1. Check `GET /api/sync/status` — note `status`, `phase`, `done/total`, `perResource`, and `error.code`.
2. If `status: "running"` and `done` is stuck, check Render logs for `warn`/`error` entries with the `jobId`.
3. If `error.code: "RATE_LIMITED"`, see §4.
4. If `error.code: "UNAUTHENTICATED"`, see §5.
5. If `error.code: "GITHUB_UNREACHABLE"`, GitHub itself may be down — check https://www.githubstatus.com/.

### Recovery

- **For timed-out or error jobs:** wait 20+ minutes after the last sync start, then trigger "Sync now" from Settings. The stale reaper will claim the slot.
- **For partial failures on individual repos:** those repos show per-resource error in the status. A full resync from Settings will retry them.
- **If sync is permanently stuck with no logs:** the process may have restarted (Render free-tier instance replacement). Render logs will show a new `"server listening"` entry. No operator action needed — the stale reaper handles cleanup on the next user-initiated sync.

### Process restart: what gets lost

The scheduler and in-progress sync jobs are in-process (no external queue). A process restart:

- Clears all in-memory state (rate-limit semaphores, memo cache).
- Does NOT corrupt any stored data (MongoDB Atlas is external).
- Leaves any `status: "running"` jobs orphaned — they are reaped by the stale-job reaper on the next `POST /api/sync`.

---

## 7. Incident: AI Provider Unavailable (V1 only)

### Current behavior (MVP)

AI explanations are **disabled by default** (`AI_ENABLED=false`). `POST /api/insights/:id/explain` returns `501 AI_DISABLED`. This is expected — no AI outage can affect the application.

### V1 behavior (when `AI_ENABLED=true`)

If the configured LLM provider is unavailable, times out, or returns malformed output:

- The `LlmExplainer` falls back to the `TemplateExplainer` automatically.
- The response still succeeds with `aiLabel: false` and the template text.
- No user-visible error is shown; a subtle "AI summary unavailable" note may appear per `prd.md §20`.
- Log: `warn` with `code: "AI_DISABLED"` or the provider-specific error code, `operation: "llm-explain"`.

### Safe diagnostic steps (V1)

1. Confirm `AI_ENABLED=true` is set in Render env.
2. Check Render logs for `warn` entries with an AI-related operation name.
3. Confirm `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, and `AI_API_KEY` are all set in Render secret manager — **OWNER APPROVAL REQUIRED** to inspect.

### Recovery (V1)

No operator action required — fallback is automatic. The AI path is user-initiated (per-insight "Explain" button), never blocking. If the provider outage persists, set `AI_ENABLED=false` in Render env and redeploy — **OWNER APPROVAL REQUIRED**.

---

## 8. Incident: MongoDB Unavailable or Degraded

### Symptoms

- `GET /api/health` returns `db: "down"`.
- `CHECK_DB=true node scripts/healthcheck.js` exits 1.
- All authenticated API endpoints fail with `INTERNAL` 500.
- Boot log: `warn` with `msg: "mongodb unreachable"`, `operation: "mongodb-connect"`.

### What the system does automatically

**At boot:** `connectDb()` attempts connection with `serverSelectionTimeoutMS: 2000` ms. On failure:

- Retries up to 10 times (`MAX_CONNECT_RETRIES = 10`) with bounded exponential backoff: base 1s, cap 30s, plus up to 25% jitter.
- In production (`NODE_ENV=production`), after retries are exhausted the boot fails fast and the process exits, triggering a Render service restart.
- Retry timers are `unref`'d so they do not prevent clean shutdown.

**After successful boot (transient outage):** if MongoDB becomes unreachable later, `dbStatus()` returns `"down"` in the health response. The retry logic re-applies automatically when the next connection attempt is triggered.

**Log fields to watch:**

```json
{ "msg": "mongodb unreachable", "code": "...", "operation": "mongodb-connect" }
{ "msg": "mongodb retry scheduled", "retry": 3, "maxRetries": 10, "delayMs": 4000 }
{ "msg": "mongodb connected" }
```

### Safe diagnostic steps

1. `node scripts/healthcheck.js https://frieday.onrender.com` — if exit 1 with `DOWN`, confirm `db: "down"` in health JSON.
2. Check Render logs for `mongodb unreachable` warn entries and retry counts.
3. Check MongoDB Atlas dashboard for cluster health, connection count, and network access settings. **OWNER APPROVAL REQUIRED** to access Atlas.

### Recovery

- **Transient outage (Atlas blip):** the server will self-heal within retry budget (10 × up to 30s ≈ ~5 min maximum). No action required.
- **Persistent Atlas outage:** Check Atlas status at https://status.mongodb.com/. If Atlas reports an incident, wait for resolution. No operator code change required.
- **IP allowlist issue (0.0.0.0/0 currently set):** not applicable — the Atlas allowlist is currently open. If you have tightened the allowlist, add the Render egress IP. **OWNER APPROVAL REQUIRED**.
- **Atlas auto-pause (M0 free tier after 30 days idle):** wake the cluster in the Atlas console before verification. **OWNER APPROVAL REQUIRED**.

### Warning: Atlas backup responsibility

The application does not perform its own backups. M0 free tier does not include automatic backups. Manual snapshots must be taken in the Atlas console. This is a documented gap — see `docs/deployment.md §3`.

### Restore process (Atlas — OWNER APPROVAL REQUIRED)

Do not restore over the live production cluster without explicit owner decision.

1. Atlas → Backups → select snapshot → restore to a **new cluster**.
2. Verify restored data on the new cluster with `node scripts/smoke.js <staging-url>`.
3. Update `MONGO_URI` in Render env to point to the restored cluster only after verification.
4. A deleted user's rows remain inside Atlas backups until retention expiry — no automated purge (`docs/deployment.md §9`).

---

## 9. Incident: Production Deployment Failure and Rollback

### Detection

A bad deployment shows as one or more of:

- `node scripts/smoke.js https://frieday.onrender.com` has failing checks (exit 1).
- `GET /api/health` returns non-200 or `db: "down"`.
- Dashboard errors in Render logs after a deploy event.
- Client-side JS console errors visible in browser dev tools.

### Safe diagnostic steps

1. Run `node scripts/smoke.js https://frieday.onrender.com` — note which of the 6 checks fail.
2. Check Render logs for `error` entries near the deploy timestamp.
3. If `db: "down"`, see §8.
4. If `github: "unconfigured"`, a required env var (`GITHUB_CLIENT_ID`) is missing from Render — **OWNER APPROVAL REQUIRED**.

### Rollback (OWNER APPROVAL REQUIRED)

Render supports rolling back to a previous deploy from the Render dashboard:

1. Render Dashboard → your service → Events → select the last known-good deploy → "Redeploy".
2. The stateless app reattaches to the same Atlas cluster without migration.
3. The application never runs destructive schema migrations on boot, so a version downgrade is safe from a data-integrity standpoint.
4. Expect a brief restart with no zero-downtime (Render Free tier uses a single instance).

After rollback, run `node scripts/smoke.js https://frieday.onrender.com` and confirm 6/6 pass.

### When NOT to roll back

If the deployment wrote new MongoDB documents (e.g., from webhook-triggered syncs), a code-version rollback is usually preferable to a data restore. Only restore MongoDB if data corruption was caused by the application, and only after explicit owner decision — see §8 restore guidance.

---

## 10. Incident: Webhook Signature Failure, Duplicate Delivery, Delayed Freshness

### Signature failure (401)

**Symptom:** GitHub webhook delivery shows a `401` response in the GitHub webhook history (Settings → Webhooks → recent deliveries).

**Cause:** `WEBHOOK_SECRET` in Render env does not match the secret configured in the GitHub webhook settings, or the secret is empty (webhook endpoint returns `404 WEBHOOKS_V1` when `WEBHOOK_SECRET` is unset).

**Safe diagnostic steps:**

1. Confirm `WEBHOOK_SECRET` is set in Render env — **OWNER APPROVAL REQUIRED** to inspect the value.
2. Confirm the GitHub webhook "Secret" field matches (GitHub → repo Settings → Webhooks → edit). **OWNER APPROVAL REQUIRED**.

**Recovery:** Update one side to match the other. HMAC verification is HMAC-SHA256 over the exact raw request bytes — the implementation does not accept `sha1` signatures.

### Duplicate delivery (200 deduped)

**Symptom:** GitHub retries a delivery and the second response is `{"received":true,"deduped":true}`. This is **expected and correct behavior** — delivery dedupe is persisted via a unique index on `X-GitHub-Delivery` ID in the `webhookdeliveries` collection. No action required.

### Delayed freshness (p95 > 5 min target)

**Symptom:** A push event was received but repo data in the dashboard reflects pre-push state for more than 5 minutes.

**Cause (check in order):**

1. **Sync conflict:** a full sync or another webhook-triggered incremental sync was already running for the same user (single-flight claim). The event is marked `conflict` in logs and skipped. Freshness will restore once the active sync completes.
2. **Rate limit during incremental sync:** see §4.
3. **Stale-event guard:** the event's timestamp is older than the repository's persisted `githubUpdatedAt`. The event was correctly discarded (`skipped-stale`) because it could not add newer data. GitHub may have redelivered an old event.
4. **Render cold start:** if the service was idle, the first request wakes it (see §11). Webhook events received during the sleep window are not buffered by Frieday — they are delivered by GitHub to the live endpoint. If the endpoint was sleeping, GitHub's delivery may have failed; redeliver from GitHub webhook settings — **OWNER APPROVAL REQUIRED**.

**Log fields for webhook freshness:**

```json
{
  "msg": "webhook freshness",
  "receivedAt": "...",
  "startedAt": "...",
  "completedAt": "...",
  "durationMs": 12450
}
```

These are emitted by the incremental ingest path on completion.

**The 6-hour scheduler** (`SCHEDULER_ENABLED=true`) acts as a backstop for missed webhook events.

---

## 11. Render Cold Starts and Slow First Request

### Behavior

Render Free tier suspends the service after approximately 15 minutes of inactivity. The first HTTP request after suspension wakes the service, incurring approximately 30–60 seconds of latency before the response is returned.

Indicators:

- `uptime` value in `GET /api/health` is a small number (< 120s) after a long idle period.
- The first request from a user takes noticeably longer than subsequent ones.

### Effect on operations

- **Health checks:** a health check sent during wake-up may time out or return slowly. The `node scripts/healthcheck.js` script has a 5-second timeout (`TIMEOUT_MS = 5000`). If the service was asleep, increase the wait window and retry.
- **Webhook deliveries during sleep:** GitHub delivers the webhook to the live HTTPS endpoint. If the service is sleeping, the first delivery attempt may time out before the server wakes. GitHub retries webhook deliveries on failure — the retry will succeed after wake-up. If not, use "Redeliver" in GitHub webhook settings — **OWNER APPROVAL REQUIRED**.
- **Scheduler:** the node-cron scheduler is in-process. After a cold start, the scheduler restarts on the next `start()` call from `index.js`. The first scheduled cron fire will happen at the next aligned cron time (00:00/06:00/12:00/18:00 UTC).

### Mitigation (no action available on free tier)

Render Free does not support disabling suspend. Upgrade to a paid Render instance for always-on behavior. This is a documented limitation of the current hosting tier — see `docs/deployment-readiness-report.md §6`.

---

## 12. Backup / Restore Responsibilities

This section summarizes the documented state. **No automated backup is performed by the application.**

| Item                           | Responsibility       | Mechanism                                                           |
| ------------------------------ | -------------------- | ------------------------------------------------------------------- |
| MongoDB data backup            | Atlas (owner action) | Manual snapshots on M0 free; automatic backups require M10+         |
| Application code/config backup | Git repository       | `origin/main` on GitHub                                             |
| Render env vars                | Owner                | Render secret manager (Render does not back up env vars externally) |
| GitHub OAuth credentials       | Owner                | GitHub Developer Settings; regenerate if lost                       |

**Delete-data SLA (implemented):** `DELETE /api/auth/data` removes all user-scoped records synchronously and returns per-collection delete counts. If the operation fails, it returns `503 retryable`. A deleted user's rows remain inside Atlas backup snapshots until retention expiry — there is no automated purge of backup copies (`docs/deployment.md §9`).

### Logical backup/restore procedure (the Atlas M0 recovery path)

Because M0 has no automatic snapshots, the supported recovery method is a **logical
export/import** (`mongodump`/`mongorestore`, or `mongoexport`/`mongoimport` per collection).
The Node driver equivalent (collection → JSON → collection) was **drill-verified locally**
on 2026-10-20 against a disposable `frieday_backup_drill` database with synthetic data:
seed → export → simulate loss (`dropDatabase`) → restore → verify. Counts, per-document
integrity checksums, and the commit→repository referential invariant all matched after
restore; the drill database was dropped on completion. Exit code 0.

**Owner backup command (run from a machine with Atlas access; never prints the URI):**

```powershell
# Requires mongodb-database-tools installed (mongodump/mongorestore).
# $env:MONGO_URI holds the Atlas connection string — do NOT echo it.
mongodump --uri="$env:MONGO_URI" --out="backup-$(Get-Date -Format yyyyMMdd)"
```

**Owner restore command (restore to a NEW database/cluster, never over production):**

```powershell
mongorestore --uri="$env:MONGO_URI" --nsFrom="frieday.*" --nsTo="frieday_restored.*" "backup-YYYYMMDD/frieday"
# Verify the restored namespace before repointing MONGO_URI in Render.
```

**Scope limitation — NOT VERIFIED (OWNER ACTION REQUIRED):** the drill proves the
_logical_ export/import round-trips correctly. It does **not** prove an Atlas-console
snapshot restore, nor connectivity/permissions against the production cluster, because
that requires owner Atlas credentials. A production restore must follow §8 (restore to a
**new** cluster first, verify with `node scripts/smoke.js <staging-url>`, then repoint
`MONGO_URI`). Do not restore over the live cluster.

---

## 13. Escalation Path

| Severity | Symptom                               | Safe operator action                          | Owner required                                  |
| -------- | ------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| P0       | `db: "down"`, all users affected      | Run smoke test; check Render + Atlas logs     | Yes — Atlas recovery, env var changes, redeploy |
| P0       | Smoke test exits 1 after deploy       | Identify failing check; check Render logs     | Yes — rollback decision                         |
| P1       | Single user sync permanently failing  | Check sync status; confirm error code         | Only if env var change needed                   |
| P1       | Webhook consistently returning 401    | Document the symptom                          | Yes — secret rotation                           |
| P2       | Slow dashboard (> 2.5s)               | Check Render logs for slow query warns        | Owner if Atlas scaling needed                   |
| P2       | Render cold-start first-request delay | Expected behavior; document if recurring      | Only if paid tier upgrade                       |
| Info     | Stale job reaped log                  | Normal self-healing behavior                  | No action                                       |
| Info     | Scheduler tick log                    | Expected every 6h if `SCHEDULER_ENABLED=true` | No action                                       |

**Operators** can: run smoke and healthcheck scripts, read Render logs, check Atlas dashboard status, read GitHub webhook delivery history.

**Operators must not**: change Render env vars, rotate secrets, modify Atlas network access, redeliver GitHub webhooks, create or delete Atlas clusters, or make any change that could affect production data or configuration. All of these require explicit owner approval.

---

## 14. Known Gaps and Documented Limitations

| Gap                                                                       | Status                                                                | Source                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| No alerting / on-call integration                                         | Not implemented; no PagerDuty, Datadog, or uptime monitor wired       | No external monitoring in MVP scope                 |
| No automated backup on Atlas M0 free tier                                 | Manual snapshots only; backup must be initiated manually              | `docs/deployment.md §3`                             |
| Single-process scheduler — duplicate ticks if scaled to multiple replicas | Documented; BullMQ+Redis is the documented V1 fix                     | `docs/deployment.md §5`, `architecture.md §16`      |
| Render free-tier suspend                                                  | ~15 min idle → sleep; ~30–60s cold start                              | Free tier limitation; upgrade to paid for always-on |
| Atlas 0.0.0.0/0 network allowlist                                         | Render Free has no static egress IP; scoped access requires paid tier | `docs/deployment-readiness-report.md §17.7`         |
| Webhook delivery retry during cold start                                  | GitHub retries failed deliveries; no in-app buffer                    | Expected; scheduler is the backstop                 |
| No Redis / BullMQ queue                                                   | Webhooks and scheduled syncs run in-process                           | V1 migration path documented, not implemented       |
| AI explanation (V1)                                                       | `AI_ENABLED=false` in MVP; template fallback always active            | `md files/prd.md §9/F9`                             |
| SEC-1 react-router advisories                                             | Owner-approved time-bounded exception; reassessment 2026-11-16        | `docs/phase8-acceptance-report.md`                  |
