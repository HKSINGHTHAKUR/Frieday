# Frieday — Ops Runbook (Phase 9, T9.2)

> On-call guide: every common incident as **symptom → check → fix**. Companion:
> `docs/deployment.md` (provisioning, Atlas, backup/restore, delete-SLA, rollback),
> `docs/webhooks.md` (webhook), `md files/architecture.md` §15 (observability).
>
> Status legend: **IMPLEMENTED** = code exists + automated tests prove it ·
> **VERIFIED** = proven in a live environment · **MANUAL PRODUCTION STEP** =
> requires live credentials/infra, documented exactly · **NOT VERIFIED — ENVIRONMENT
> REQUIRED** = cannot be confirmed without a real deployment.

---

## 0. How to read the system

**Logs** — pino JSON, one line per event, `LOG_LEVEL`-gated (`info` default):

- Request flows: every line carries `reqId` (matches the response `X-Request-Id`), e.g. `{"level":30,"reqId":"...","msg":"sync started","jobId":"..."}`.
- Job flows (sync / scheduler / webhook ingest): every line carries `jobId` + `userId`, e.g. `{"level":30,"jobId":"...","userId":"...","msg":"sync finished","status":"succeeded"}`.
- Secrets/URIs/tokens are **never** logged (verified by tests, T8.2/T9.2).

**Health** — `GET /api/health` → `{ ok, version, db: "up"|"down", github: "configured"|"unconfigured", uptime }`. No network calls; safe to hit from monitors.

**Sync history** — `GET /api/sync/status` returns `history[]` (last 20 jobs/user): `jobId, kind, status, startedAt, finishedAt, error`. Also visible in **Settings → Sync → Recent syncs**.

**Commands** (from the repo root):

```bash
node scripts/healthcheck.js https://<host>            # exit 0/1
CHECK_DB=true node scripts/healthcheck.js ...          # also require db:up
node scripts/smoke.js https://<host>                   # fuller prod smoke
```

---

## 1. GitHub rate limiting

- **Symptom:** sync shows `RATE_LIMITED` + `resumeAt` (UI: "GitHub rate limit reached — resumes automatically at HH:MM"); logs show rate-limit backoff; dashboard still renders prior good data.
- **Check:** `GET /api/sync/status` → `error.code === 'RATE_LIMITED'`; logs: `warn` level backoff entries with `reqId`/`jobId`. GitHub's `x-ratelimit-*` headers drive the gate (`services/github/rateLimit/*`).
- **Fix:** wait for `resumeAt` (do **not** spam sync — the gate + concurrency cap already back off). Manual retry after reset: POST `/api/sync`. The 6h scheduler and webhook both pass through the same gate, so they cannot stampede. If a user is permanently limited, check they did not revoke the OAuth app (see §2).
- **Drill (live env):** temporarily set `SYNC_CONCURRENCY=1` and hammer GitHub until 403/429, or use a fixture whose fetcher throws 429; confirm status shows `RATE_LIMITED` with a future `resumeAt`, prior data stays, and the UI renders the rate-limited state. **NOT VERIFIED — ENVIRONMENT REQUIRED** until run against a live deployment.

---

## 2. Revoked / expired GitHub token

- **Symptom:** user's sync fails with `UNAUTHENTICATED` ("No connected GitHub account…"); Settings shows "GitHub connection expired" with a **Reconnect** CTA (`/api/auth/me` → `connected:false`); no crash, dashboard keeps old data.
- **Check:** `GET /api/auth/me` → `connected`; logs: `UNAUTHENTICATED` with `reqId`; the stored token is absent or rejected by GitHub (401/403 on fetch).
- **Fix:** user clicks **Reconnect** (fresh OAuth flow re-upserts a token). No data loss — reconnection preserves synced rows and the next sync is incremental from saved cursors.
- **Drill (live env):** GitHub → Settings → Applications → Revoke Frieday → trigger sync → confirm the reconnect CTA and that a reconnect restores sync without a full re-fetch of unchanged data. **NOT VERIFIED — ENVIRONMENT REQUIRED.**

---

## 3. Stuck / failed sync

- **Symptom:** a sync stays `running` past the 15-min timeout, or finishes `failed` with a per-resource error; dashboard still renders prior good data (partial failures never wipe data).
- **Check:** `GET /api/sync/status` → `status`, `phase`, `perResource` errors; Settings → Recent syncs shows the failed job; logs: `sync aborted` / `terminal state write failed` with `jobId`.
- **Fix:**
  - **Stuck:** a run older than `SYNC_TIMEOUT_MS + 5min` is reaped as `failed` (message "Sync was interrupted…") on the next `startSync` (single-flight claim), then a fresh sync resumes from saved `SyncState` cursors. User can also just **Resync** — the claim logic handles it.
  - **Failed per-resource:** retry; the resumable orchestrator re-runs failed resources from cursors and keeps prior good rows (idempotent upserts).
  - If syncs repeatedly fail with `RATE_LIMITED`/`UNAUTHENTICATED`, see §1/§2.
- **Drill (live env):** kill the process mid-sync, restart, confirm the stale job is reaped with the interrupted message and a resync resumes without duplicating rows (unique-index idempotency). **NOT VERIFIED — ENVIRONMENT REQUIRED.**

---

## 4. AI unavailable

- **Symptom:** "Explain" on an insight returns template text with `aiLabel:false`; no blocking error; the insights/dashboard still render fully.
- **Check:** logs show AI fallback (`ai fallback` warn, `reason: fallbackReason`); `POST /api/insights/:id/explain` → 501 `AI_DISABLED` when `AI_ENABLED=false`; provider failures degrade to template text (never a hard error).
- **Fix:** nothing to fix for availability — AI is explanation-only (`prd.md` §19). If AI was expected to work, check `AI_ENABLED=true` + `AI_PROVIDER/AI_MODEL/AI_BASE_URL/AI_API_KEY` are set correctly; the validator rejects fabricated output and falls back safely.
- **Drill (live env):** enable AI, then point `AI_BASE_URL` at a dead endpoint, confirm a user "Explain" degrades to template text with the subtle "AI summary unavailable" note and zero blocking. **NOT VERIFIED — ENVIRONMENT REQUIRED.**

---

## 5. MongoDB unavailable

- **Symptom:** prod boot fails fast (fail-fast per `rules.md` §10); at runtime `/api/health` → `db:"down"`; authenticated endpoints return `503` `retryable` with a generic message.
- **Check:** `/api/health` → `db`; logs: `mongodb unreachable` with safe metadata only (never the URI); `healthcheck`/`smoke` report DOWN.
- **Fix:** restore Atlas connectivity (network access, cluster status, credentials). The app reconnects on the next connection attempt (single-flight connect). No data is lost — reads served from Mongo; sync jobs that failed end honestly with typed errors and can be resumed.
- **Drill (live env):** temporarily block the app's egress to the cluster (or pause the cluster) → confirm health `db:"down"`, a 503 on a protected endpoint, and full recovery after unblocking without manual intervention. **NOT VERIFIED — ENVIRONMENT REQUIRED.**

---

## 6. Health-check failure

- **Symptom:** `node scripts/healthcheck.js` (or the Docker `HEALTHCHECK`) exits non-zero; the host monitor alerts; `/api/health` returns non-200 or `ok:false`.
- **Check:** read `/api/health` JSON: `ok`, `db`, `github`, `uptime`, `version`; then `node scripts/smoke.js <host>` for the fuller surface (SPA shell, OAuth entry, auth gate, headers, no secrets). Check process logs for a boot/config failure (`Missing env: <NAME>` → invalid configuration) or DB connect failure.
- **Fix:**
  - `ok:false`/non-200 → app process broken → restart/rollback (§7).
  - `db:"down"` → Mongo incident (§5).
  - `github:"unconfigured"` → `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` missing → set env, restart.
  - Boot failure → missing/invalid required env (fail-fast names it) → fix env, restart.
- **Drill (live env):** break config (clear `JWT_SECRET`), restart, confirm the named fail-fast error and healthcheck DOWN; restore config, confirm UP. **NOT VERIFIED — ENVIRONMENT REQUIRED.**

---

## 7. Rollback procedure

See `docs/deployment.md` §8 for the full procedure. Summary:

1. **Identify a bad deployment:** smoke/healthcheck failures, client console errors, dashboard errors in logs after deploy.
2. **Revert the app version:** redeploy the previous image/tag (or `git checkout <previous-tag>` + rebuild). The app is stateless; the old build reads the same Mongo. Normal redeploy — **not** zero-downtime unless the host does rolling deploys.
3. **Preserve/restore DB integrity:** the app runs no destructive boot migrations, so an app-version rollback needs no schema rollback. Only restore Mongo (Atlas backup → new cluster → repoint `MONGO_URI`) when data was the cause — never restore over live prod blindly.
4. **When DB rollback is unsafe:** if new code wrote new fields or background jobs already ran, an older backup **loses newer user data**. Prefer app-version rollback first.
5. **Verify after rollback:** `node scripts/smoke.js <host>` (health, OAuth, dashboard) and record the run.

---

## 8. Incident / drill procedure

1. **Declare** with the affected host, the health/smoke output, and the first matching section above.
2. **Triage** by reading logs (filter by `reqId`/`jobId`), `/api/health`, and `/api/sync/status` — enough to diagnose without the UI.
3. **Fix** per the section; record what changed.
4. **Verify** recovery: healthcheck UP + smoke PASS + affected user flow (login/sync/dashboard) works.
5. **Log** the incident in the phase report with evidence (drill output).

Drills are the live-environment execution of each section's **Drill** step. Until a real deployment exists, drill results are **NOT VERIFIED — ENVIRONMENT REQUIRED**; do not claim them as completed.
