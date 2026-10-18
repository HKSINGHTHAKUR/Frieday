# Frieday — Production Deployment (Phase 9, T9.1)

> Companion docs (authoritative): `md files/prd.md`, `md files/architecture.md`, `md files/rules.md`, `md files/design_system.md`, `md files/agents.md`, `md files/tasks.md`. Webhook specifics: `docs/webhooks.md`. Ops incidents: `RUNBOOK.md` (T9.2).

**Deployment model chosen (T9.1 Option A, per `architecture.md` §13/§17):** a single Node/Express process serves BOTH the production client build and the `/api` routes.

```text
Browser ──▶ production frontend (client/dist, same origin)
              └──▶ /api ──▶ Express ──▶ MongoDB (Atlas) / GitHub
```

Why this matches the docs: `architecture.md` §13's CSP is explicitly "enforced on every Express response, including the SPA once Express serves the client build (tasks.md T9.1 option A)"; `prd.md` NFR-2 ("single Node process + MongoDB Atlas") and §24 ("No premature microservices... Single deployable + managed Mongo is correct"); `rules.md` §9 (restrictive CORS + credentials) works trivially because the browser talks to one origin. No Redis/BullMQ (`architecture.md` §18.4 — node-cron remains the scheduler).

The same-origin setup means: `VITE_API_URL` stays **unset** (relative `/api`), cookies (`fd_access`/`fd_refresh`, HttpOnly + Secure in prod) flow normally, and no CORS preflight is involved.

---

## 1. Environment Variable Audit

Authoritative list lives in `.env.example` + `server/src/config/env.js` (zod, fail-fast, `rules.md` §10). No code reads `process.env` outside `config/env.js` (verified). Categories:

| Variable                                                                                              | Required                      | Secret           | Server/Public           | Notes / format                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Server core**                                                                                    |                               |                  |                         |                                                                                                                                                         |
| `NODE_ENV`                                                                                            | yes (prod)                    | no               | server                  | `production` — controls cookie `Secure`, HSTS, DB fail-fast                                                                                             |
| `PORT`                                                                                                | no (default 5000)             | no               | server                  | container port; Docker exposes 5000                                                                                                                     |
| `CLIENT_URL`                                                                                          | yes (prod)                    | no               | server                  | **production origin** for the CORS allowlist, e.g. `https://frieday.example.com`                                                                        |
| `LOG_LEVEL`                                                                                           | no (default info)             | no               | server                  | `debug\|info\|warn\|error`                                                                                                                              |
| **B. Database**                                                                                       |                               |                  |                         |                                                                                                                                                         |
| `MONGO_URI`                                                                                           | yes (prod)                    | **yes**          | server                  | Atlas `mongodb+srv://<dbUser>:<dbPass>@<cluster>.../?retryWrites=true&w=majority` — consumed by `config/db.js`; never logged (safe-error hygiene, T8.2) |
| **C. GitHub OAuth**                                                                                   |                               |                  |                         |                                                                                                                                                         |
| `GITHUB_CLIENT_ID`                                                                                    | yes (prod)                    | no (public)      | server                  | OAuth App Client ID                                                                                                                                     |
| `GITHUB_CLIENT_SECRET`                                                                                | yes (prod)                    | **yes**          | server                  | server-only exchange                                                                                                                                    |
| `GITHUB_SCOPES`                                                                                       | no (default `read:user repo`) | no               | server                  | keep `read:user repo` per `prd.md` §17                                                                                                                  |
| `GITHUB_CALLBACK_URL`                                                                                 | yes (prod)                    | no               | server                  | **must equal** the OAuth App callback, e.g. `https://frieday.example.com/api/auth/github/callback`                                                      |
| `GITHUB_TOKEN_URL` / `GITHUB_API_USER_URL` / `GITHUB_API_BASE`                                        | no                            | no               | server                  | prod defaults point at github.com; leave commented                                                                                                      |
| **D. GitHub API/webhook**                                                                             |                               |                  |                         |                                                                                                                                                         |
| `WEBHOOK_SECRET`                                                                                      | yes (V1 prod)                 | **yes**          | server                  | any strong random string; must match the GitHub webhook "Secret" field; empty = webhooks disabled (404 `WEBHOOKS_V1`)                                   |
| **E. Session/auth**                                                                                   |                               |                  |                         |                                                                                                                                                         |
| `JWT_SECRET`                                                                                          | **yes**                       | **yes**          | server                  | ≥16 chars (HS256 signing)                                                                                                                               |
| `TOKEN_ENC_KEY`                                                                                       | **yes**                       | **yes**          | server                  | exactly 64 hex chars (32 bytes, AES-256-GCM for GitHub tokens)                                                                                          |
| **F. AI (V1, optional)**                                                                              |                               |                  |                         |                                                                                                                                                         |
| `AI_ENABLED`                                                                                          | no (default false)            | no               | server                  | `false` in MVP/V1 default                                                                                                                               |
| `AI_PROVIDER` / `AI_MODEL` / `AI_BASE_URL` / `AI_API_KEY`                                             | no                            | `AI_API_KEY` yes | server                  | only when AI enabled                                                                                                                                    |
| **G. Client/public**                                                                                  |                               |                  |                         |                                                                                                                                                         |
| `VITE_API_URL`                                                                                        | no                            | no               | **public** (build-time) | leave **unset** (same-origin Option A); only needed for separate static hosting                                                                         |
| **H. Scheduler/runtime**                                                                              |                               |                  |                         |                                                                                                                                                         |
| `SCHEDULER_ENABLED`                                                                                   | no (default false)            | no               | server                  | `true` enables the node-cron 6h staggered sync (`jobs/scheduler.js`)                                                                                    |
| `SYNC_CONCURRENCY`                                                                                    | no (default 2)                | no               | server                  | GitHub concurrency cap                                                                                                                                  |
| `SYNC_MAX_REPOS` / `SYNC_MAX_COMMITS_PER_REPO` / `SYNC_MAX_PRS_PER_REPO` / `SYNC_MAX_ISSUES_PER_REPO` | no                            | no               | server                  | sync caps (`architecture.md` §8)                                                                                                                        |

Rules: **never** put `GITHUB_CLIENT_SECRET`, `JWT_SECRET`, `TOKEN_ENC_KEY`, `MONGO_URI`, `WEBHOOK_SECRET`, `AI_API_KEY` in the client build or commit them. `VITE_*` is the only public category and contains no secrets.

---

## 2. Provisioning Checklist (new environment)

1. **MongoDB Atlas** — see §3.
2. **GitHub OAuth App** — see §4.
3. **Generate secrets**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET (and TOKEN_ENC_KEY needs 64 hex)
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # WEBHOOK_SECRET
   ```
   Set every env var listed in §1. Fail-fast check: the server refuses to boot without `JWT_SECRET` + `TOKEN_ENC_KEY` (`Missing env: <NAME>`).
4. **Webhook** — create in the GitHub repo/org with payload URL `https://<host>/api/webhooks/github` (see `docs/webhooks.md`); `push`, `pull_request`, `issues`; content type `application/json`; secret = `WEBHOOK_SECRET`. Expect `ping` → `{"received":true,"pong":true}`.
5. **Build & deploy** — see §6 (Docker) or §7 (manual).
6. **Smoke** — `node scripts/smoke.js https://<host>` and record output (see §11).

---

## 3. MongoDB Atlas

### Cluster setup (MANUAL PRODUCTION STEP)

1. Create an M0+ cluster (region near your app host). Atlas is the **external managed MongoDB** — do not run Mongo in a container.
2. **Database user**: create a user (e.g. `frieday-app`) with `readWrite` on the `frieday` database only. Do not grant cluster-wide admin to the app user.
3. **Network access**: add your app host's egress IP (or, for a platform with dynamic egress, an Atlas Private Endpoint / VPC peering — pick per host). `0.0.0.0/0` is only acceptable with strong cluster auth + IP allowlist review; prefer scoped access.
4. **MONGO_URI**: `mongodb+srv://frieday-app:<password>@<cluster>/frieday?retryWrites=true&w=majority`. Put it in the runtime env; it is never logged (`config/db.js` logs safe metadata only, T8.2 hygiene).

### Application readiness (already implemented, verified by tests)

- `MONGO_URI` is read + zod-validated in `config/env.js`; defaults to local dev URI when unset.
- `config/db.js`: connection is single-flight (one pending connect), `serverSelectionTimeoutMS: 2000`, resolves-but-reports-`db:down` outside production so dev works without a DB, and **fails fast in production** (fail-fast per `rules.md` §10). Failure messages are typed/safe (no URI in logs).
- User-scoped queries: every data query carries `userId` (models + services + cross-user tests) — unchanged.
- **Indexes**: Mongoose auto-creates the schema indexes (`architecture.md` §6: unique GitHub-ID compounds, `(userId, authoredAt)` sort index, delivery-ID unique index) on first boot in production. Verify once after first deploy:
  ```bash
  mongosh "mongodb+srv://<admin>@<cluster>/frieday" --eval "db.getCollectionNames().forEach(c=>printjson(db[c].getIndexes()))"
  ```

### Backup / restore

- **IMPLEMENTED:** nothing is self-backup'd in the app — backups are Atlas's responsibility (documented, not performed here).
- **MANUAL PRODUCTION STEP:** enable Atlas **cloud backups** (M10+; M0 free tier does not include automatic backups — plan accordingly) with a snapshot schedule (e.g. daily, 7-day retention) and a point-in-time recovery window if budget allows.
- **Restore process (Atlas):** Atlas → Backups → Restore → pick snapshot/PITR → restore to a new cluster (recommended, keeps prod untouched) → update `MONGO_URI` of a staging instance to verify → promote/switch DNS only after verification.
- **Restore verification:** run `node scripts/smoke.js <staging>` and spot-check a seeded account (`/api/dashboard?range=30d` renders counts; `/api/auth/me` resolves the account).
- **Disaster recovery notes:** data is in Atlas (managed replication). If the app region dies, redeploy the Docker image to a second region pointing at the same cluster. If the cluster dies, restore from backup to a new cluster and repoint `MONGO_URI`; do not downgrade Mongo versions across restore unless Atlas supports it.

---

## 4. GitHub OAuth + Webhook

### OAuth App settings (MANUAL PRODUCTION STEP)

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. **Homepage URL**: `https://<host>/`.
3. **Authorization callback URL**: `https://<host>/api/auth/github/callback` — must equal `GITHUB_CALLBACK_URL`.
4. Scopes requested by the app: `read:user repo` (`GITHUB_SCOPES`), stated plainly on the login page (`prd.md` §17).
5. Copy Client ID → `GITHUB_CLIENT_ID`, generate Client Secret → `GITHUB_CLIENT_SECRET` (server env only).

Verified in code (unchanged by T9.1): OAuth `state` CSRF cookie is HttpOnly + `Secure` in prod; callback verifies state before any exchange (403 on mismatch); token exchanged server-side and encrypted with AES-256-GCM (`TOKEN_ENC_KEY`); tokens never reach the browser (`rules.md` §7). Production cookie settings: `HttpOnly; Secure (NODE_ENV=production); SameSite=Lax; Path=/` (`session.service.js`).

### Webhook

- URL: `https://<host>/api/webhooks/github` — reachable behind the deployed server (HMAC gate first, `docs/webhooks.md`).
- Secret: `WEBHOOK_SECRET` (env) = GitHub webhook secret.
- Events: `push`, `pull_request`, `issues` (allowlist, `architecture.md` §9); content type `application/json`; `ping` auto-delivered.
- HMAC-SHA256 over exact raw bytes is mandatory (`401` without it); delivery-ID dedupe is persisted (unique index); stale-event guard prevents regression.

---

## 5. Scheduler

- Enabled with `SCHEDULER_ENABLED=true`. node-cron, every 6h (UTC), staggered 5s per user, bounded to `MAX_USERS_PER_TICK=1000` per tick (`server/src/jobs/scheduler.js`).
- Every scheduled run goes through the existing per-user single-flight claim + rate-limit gate + caps; already-running syncs are skipped (`SYNC_CONFLICT`), never re-queued.
- **Single-process assumption:** this scheduler is in-process. Running **multiple app replicas** would duplicate the 6h tick unless the architecture handles it (documented `architecture.md` §16/§18.4: "MVP (1 instance)"). The documented V1 fix is Redis/BullMQ — **explicitly not added in T9.1**. For V1 launch run **one** app instance (or accept duplicate ticks guarded by the single-flight claim — each user still only runs one sync at a time, but two replicas could both schedule a user in the same window; the second loses the claim). Do not scale replicas without the queue work.

---

## 6. Docker

`Dockerfile` (multi-stage, deterministic `npm ci` from the committed lockfile) + `.dockerignore` (no `.env`, `node_modules`, tests, docs, or git metadata in the image; no secrets baked; env injected at runtime; non-root `node` user; `HEALTHCHECK` on `/api/health`).

```text
Stage 1 builder  : npm ci → build client (client/dist) → npm prune --omit=dev
Stage 2 runtime  : pruned node_modules + server/src + client/dist → CMD node server/src/index.js
```

Build & run:

```bash
docker build -t frieday:$(node -e "console.log(require('./package.json').version)") .
docker run -d --name frieday \
  -p 5000:5000 \
  -e NODE_ENV=production \
  -e CLIENT_URL=https://<host> \
  -e MONGO_URI='mongodb+srv://...' \
  -e JWT_SECRET='...' -e TOKEN_ENC_KEY='...' \
  -e GITHUB_CLIENT_ID='...' -e GITHUB_CLIENT_SECRET='...' \
  -e GITHUB_CALLBACK_URL='https://<host>/api/auth/github/callback' \
  -e WEBHOOK_SECRET='...' \
  -e SCHEDULER_ENABLED=true \
  frieday
```

External Mongo (Atlas) is not containerized. No `docker-compose` is provided — a single image needs no composition; compose adds value only if the operator wants the runtime env in a file (provide it as `env_file` yourself, keep it out of git).

---

## 7. Deploy-from-clean-checkout runbook

Manual (no Docker):

```bash
git clone <repo> frieday && cd frieday
npm ci
Copy-Item .env.example .env    # fill per §1 (or export env vars)
npm run build -w client        # → client/dist
npm run start -w server        # serves /api AND client/dist
```

The server serves the SPA when `client/dist/index.html` exists (`server/src/app.js`, `spaMiddleware`); `/api/*` keeps the JSON error envelope.

---

## 8. Rollback

Bad-deployment detection: `node scripts/smoke.js <host>` failures, `/api/health` not OK, dashboard errors in logs, or client-side console errors after deploy.

- **Revert the application version:** redeploy the **previous image/tag** (or `git checkout <previous-tag>` + rebuild). Stateless app: the old build reads the same Mongo and re-serves the previous client build. This is a normal redeploy — **not** zero-downtime and **not** instant unless the host does rolling deploys; expect a brief restart.
- **Preserve/restore database integrity:** the app never runs destructive migrations on boot, so downgrading the app does not require a schema rollback. If data corruption came from the app (not the deploy), restore Mongo from Atlas backup (§3) to a new cluster and repoint `MONGO_URI` — never restore over live prod blindly.
- **When DB rollback is unsafe:** if new code wrote a new field or a background job already ran (scheduler/webhook), restoring an older backup would **lose newer user data**. Prefer app-version rollback first; only restore the DB when data was the cause, and only after verifying the restore target is the intended point in time.
- **Verify after rollback:** run the smoke script; confirm `/api/health` OK, OAuth login works, and the dashboard renders production data. Record the run in the deploy log.

---

## 9. Delete-SLA (as implemented — `server/src/routes/auth.routes.js`)

- **What is deleted:** `DELETE /api/auth/data` (Settings → Delete my data) synchronously removes **all user-scoped collections** (`repositories`, `commits`, `pullrequests`, `issues`, `languagesnapshots`, `activitybuckets`, `insights`, `syncstates`, `syncjobs`) **and the user document itself**, returning accurate per-collection delete counts. Session cookies are cleared.
- **What is not deleted:** the **GitHub OAuth grant** is _external_ to Frieday and persists after `Delete` (the stored token is destroyed locally, but the app's GitHub authorization remains until the user revokes it — via `Disconnect` in Settings or GitHub → Settings → Applications). `webhookdeliveries` is a global dedupe ledger with **no user data** (deliveryId + event only) and is intentionally not user-scoped; it is not purged by a user delete.
- **Timing/SLA:** immediate, synchronous, best-effort-reliable (a failure returns `503 retryable` and nothing is partially claimed — retry is safe and idempotent). No async cleanup step. There is no background purge.
- **Reconnect:** reconnecting later starts from scratch (fresh token, empty data); GitHub data is **re-fetched** on the next sync — no stale rows are resurrected.
- No legal/compliance guarantees beyond the above are made; `prd.md` §16 notes automated-backup purge is a documented limitation (a deleted user's rows removed from the live DB; they may remain inside an Atlas backup until retention expiry — see §3).

---

## 10. Production Security Check (T9.1, before deploy)

- [ ] No `.env` committed; `.gitignore` + `.dockerignore` exclude it.
- [ ] No credentials hardcoded anywhere (secret-scan: `git grep -i "sk-\|ghp_\|BEGIN PRIVATE"` clean).
- [ ] `MONGO_URI`/tokens never logged (safe-error hygiene, T8.2).
- [ ] Cookies: HttpOnly + Secure (prod) + SameSite=Lax (`session.service.js`).
- [ ] CORS allowlist = `CLIENT_URL` only, credentials allowed, never `*`.
- [ ] CSP + HSTS + helmet active on every response incl. the SPA (pinned by `securityHeaders.test.js`).
- [ ] `x-powered-by` disabled.
- [ ] Webhook HMAC mandatory (`401` without it); OAuth state mandatory (`403` on mismatch).
- [ ] Error responses never expose internal messages/stacks (`errorHandler.js`).
- [ ] Client bundle has no secrets (`VITE_*` public-only; `VITE_API_URL` unset).

---

## 11. Smoke Test

```bash
node scripts/smoke.js https://<host>
```

Automated checks: health shape + `db: up`, SPA shell served, OAuth entry redirects to GitHub, auth gate returns 401 unauthenticated, helmet security headers, and no secret patterns in the health response. The interactive OAuth-login → sync → dashboard and webhook-redelivery items are printed as manual steps (browser + real GitHub/Mongo required). Record the output for the phase report.

Host/container health probing: `node scripts/healthcheck.js [baseUrl]` (exit 0/1; `CHECK_DB=true` also requires `db:"up"`) — the Docker image already ships an equivalent `HEALTHCHECK`. See `RUNBOOK.md` for incident handling.

---

## 12. Status Legend

- **IMPLEMENTED / VERIFIED** — code present and proven by the automated suite.
- **MANUAL PRODUCTION STEP** — requires live credentials/infrastructure; documented exactly, not claimed done.
- **NOT VERIFIED — ENVIRONMENT REQUIRED** — cannot be confirmed without a live deployment (Atlas, GitHub App, deployed webhook, real browser flow).
