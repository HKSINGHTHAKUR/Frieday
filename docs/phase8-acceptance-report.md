# Frieday — Phase 8 Acceptance & Security Report (Final Closure Run)

> Task: T8.1 (Acceptance + edge-case test sweep) + T8.2 (Security audit + fixes).
> Run date: 2026-10-17 (closure run). Executor: coding agent.
> Companion: `docs/fresh-oauth-sync-audit.md`, `md files/tasks.md`.
> Verdicts use PASS / FAIL / BLOCKED / ENVIRONMENT PENDING. BLOCKED items are never reported as PASS.
> Historical totals from the interrupted Phase 8 agent (739 / 839 / 878 / 913) came from incomplete or
> inconsistent command scopes and are SUPERSEDED by the verified totals in §3.

---

## 1. Executive verdict

| Item                                         | Verdict                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| T8.1 automatable acceptance gates            | **PASS with evidence** (see §3)                                                                  |
| T8.2 automated security gates                | **PASS** (SEC-1 is an approved time-bounded exception, not a fix — see §11)                      |
| Live OAuth round-trip + live initial sync    | **PASS** (browser-verified — see `docs/fresh-oauth-sync-audit.md` §7)                            |
| Production-environment security verification | **ENVIRONMENT PENDING** (no deployment exists)                                                   |
| Graceful shutdown (SIGTERM/SIGINT)           | **IMPLEMENTED + code-verified**; process-level signal tests not executable on Windows (see §3.4) |
| Test teardown / hanging connections          | **FIXED** (auth.test.js, repos.fetcher.test.js — see §3.3)                                       |
| T8.1 final status                            | `[~]` — remaining: production-environment verification (ENVIRONMENT PENDING)                     |
| T8.2 final status                            | `[~]` — remaining: SEC-1 reassessment 2026-11-16 + production-environment verification           |
| Phase 9                                      | **LOCKED** (Phase 8 DoD not fully met — production-environment verification pending)             |

---

## 2. Environment used

- Node v24.19.0, npm 11.17.0, Windows. **No Docker** (`docker` CLI absent — image build and container smoke/shutdown tests NOT VERIFIED, see §12).
- MongoDB reachable at 127.0.0.1:27017 (local MongoDB Server 9.0, `mongod` process running).
- Isolated test database `frieday_test_configdb`, verified separate from dev database `frieday`.
- No production/staging deployment exists. No HTTPS deployment has occurred.
- All DB-gated suites run against `mongodb://127.0.0.1:27017/frieday_test_configdb` (MONGO_URI overridden at runtime; `.env` untouched — it points to Atlas, which is unreachable in this environment).

---

## 3. Test results (verified, 2026-10-17, isolated local test DB)

### 3.1 Full server suite — `node --test tests/*.test.js` (all 58 files / 211 suites)

| Metric    | Value                                       |
| --------- | ------------------------------------------- |
| Tests     | 938                                         |
| Pass      | **937**                                     |
| Fail      | **0**                                       |
| Cancelled | 0                                           |
| Skipped   | 1                                           |
| Duration  | ~9.5 s                                      |
| Exit code | **0**                                       |
| Stability | Re-ran once: identical 937 / 0 / 1 / exit 0 |

The single skip is `auth.test.js` "redirects to the login page with error=db_unavailable when persistence fails" — it is skipped **by design** because it requires MongoDB to be DOWN, and MongoDB is UP in this environment.

### 3.2 Focused suites (run individually, exit code 0 each)

| Suite                                | Pass | Fail | Skip | Notes                                                             |
| ------------------------------------ | ---- | ---- | ---- | ----------------------------------------------------------------- |
| `tests/auth.test.js`                 | 9    | 0    | 1    | `db_unavailable` skipped (MongoDB UP). Previously hung; see §3.3. |
| `tests/repos.fetcher.test.js`        | 29   | 0    | 0    | All GitHub calls routed to local fake; zero real GitHub requests. |
| `tests/auth-sync-regression.test.js` | 2    | 0    | 0    | `startSync kind=initial` + OAuth callback code path.              |

### 3.3 Test teardown / hanging connections — FIXED

Two defects caused `node --test tests/auth.test.js` to hang after printing all results (no clean exit):

1. **Uncontrolled real GitHub request.** The OAuth callback fix calls `startSync()` in the background during `completes the flow`. `auth.test.js` overrode `GITHUB_TOKEN_URL`/`GITHUB_API_USER_URL` at the local fake but **not** `GITHUB_API_BASE`, so `startSync` → `fetchRepositories` hit the real `api.github.com` (observed `GET /user/repos ... 401` with a real GitHub request id). That background keep-alive connection kept the event loop alive. Fixed: `auth.test.js` now sets `process.env.GITHUB_API_BASE = fakeUrl` so every GitHub call in the suite targets the local fake (observed `404 id UNKNOWN`, zero real GitHub requests).

2. **Unclosed Mongoose connection.** The `User.upsertOne` describe opened its own Mongoose connection in `before()` but had no `after()` to `mongoose.disconnect()`. Mongoose's monitoring sockets kept the event loop alive after the first describe had already disconnected. Fixed: added an `after()` that calls `mongoose.disconnect()` (resolves safely even when already disconnected).

`repos.fetcher.test.js` teardown was also hardened: the `fakeClose` timeout handle is now `clearTimeout`ed on success (deterministic timer cleanup), which additionally resolved an ESLint `no-unused-vars` error.

### 3.4 Graceful shutdown — implemented, code-verified

`server/src/index.js` `shutdown()` previously called `process.exit(0)` immediately after firing-and-forgetting the callback-based `server.close()` and `mongoose.connection.close()`, so exit could race ahead of cleanup. Rewritten so that:

- `server.close()` is **awaited** (server stops accepting new connections before exit).
- `scheduler.stop()` runs (no new scheduled work).
- `mongoose.connection.close()` is **awaited** (MongoDB closed at the correct point).
- Errors during any step are logged at `error` level (never swallowed, never reported as successful).
- A bounded 10 s fallback (`SHUTDOWN_TIMEOUT_MS`, `unref`'d) force-exits with code 1 if cleanup genuinely stalls.
- A `shuttingDown` guard makes repeated SIGTERM/SIGINT a no-op (one coordinated shutdown).
- `process.exit(0)` is called **only after** cleanup completes.

**Process-level signal testing:** NOT executable on this host. Empirically confirmed that on Windows, `child_process.kill('SIGTERM')` and `child_process.kill('SIGINT')` force-terminate the Node process (exit code `null`, handler never invoked) — SIGTERM/SIGINT are uncatchable here. Therefore a real child-process SIGTERM/SIGINT graceful-shutdown test cannot be executed. The implementation above is verified by code inspection instead.

### 3.5 Client tests

| Command                                 | Result                     | Exit code |
| --------------------------------------- | -------------------------- | --------- |
| `node --test src/lib/apiClient.test.js` | 11 pass / 0 fail           | 0         |
| `vitest run`                            | 11 files, 74 pass / 0 fail | 0         |
| `npm run lint` (client, `eslint src`)   | clean                      | 0         |

(jsdom `HTMLCanvasElement.getContext` warnings are environment noise, not failures.)

### 3.6 Lint / formatting / build / audit

| Check                                            | Result                    | Exit code | Notes                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint (root `eslint .`)                         | PASS                      | 0         | The pre-existing `no-unused-vars` error on `repos.fetcher.test.js:68` was fixed (timer now `clearTimeout`ed on success).                                                                                                                                                                                                                                             |
| Prettier (`prettier --check .`)                  | 4 unformatted files       | 1         | `docs/phase8-acceptance-report.md` (updated in this run — will be formatted on save), plus 3 **pre-existing** files not touched this run: `server/src/services/intelligence/composer-persist.js`, `server/tests/composer.insights.test.js`, `server/tests/dbTestHygiene.test.js`. These are code-style warnings, not product defects, and pre-date this closure run. |
| Client production build (`vite build -w client`) | PASS                      | 0         | 2198 modules; chunk-size warning only (>500 kB chunk).                                                                                                                                                                                                                                                                                                               |
| `npm audit --omit=dev`                           | 2 moderate (react-router) | 1         | CVE-2025-68470 + GHSA-337j-9hxr-rhxg. **SEC-1 — approved time-bounded exception, NOT fixed** (fix is a breaking v6→v7 migration). Reassessment 2026-11-16. See §11.                                                                                                                                                                                                  |

### 3.7 What was NOT run / NOT verified

- Docker build + container smoke/shutdown: **NOT VERIFIED** — `docker` CLI is not installed on this host (command not found). Static Dockerfile inspection is not a substitute for an image build.
- Production-environment verification (HTTPS deploy, live health checks): **ENVIRONMENT PENDING** — no deployment exists.
- `git grep` secret scan: not run (no git repository in this workspace).

---

## 4. Corrections applied to malformed / duplicated prior edits

- `server/src/index.js` — graceful shutdown rewritten (see §3.4). Removed the fired-and-forgotten `server.close()` / `mongoose.connection.close()` + premature `process.exit(0)`.
- `server/tests/auth.test.js` — added `process.env.GITHUB_API_BASE = fakeUrl`; added `after()` `mongoose.disconnect()` to the `User.upsertOne` describe.
- `server/tests/repos.fetcher.test.js` — `fakeClose()` timeout handle now `clearTimeout`ed on success (deterministic cleanup; fixes lint `no-unused-vars`).
- No commits or pushes were made. Phase 9 remains LOCKED.

---

## 5. Security (T8.2) — summary

- Auth/session (httpOnly cookies, rotation, replay invalidation, AES-256-GCM, state CSRF, single-use state): PASS.
- Authorization (user scoping, cross-user 404): PASS.
- Validation (zod, cursor/range/repoId): PASS.
- Webhooks (HMAC verify, timing-safe, dedupe, hygiene): PASS.
- Headers/CORS/cookies: PASS.
- Logging (reqId/jobId, no secrets/tokens): PASS.
- `npm audit --omit=dev`: 0 High/Critical, 2 moderate react-router — **SEC-1 approved exception, not fixed** (reassessment 2026-11-16).
- Secret scan: not run (no git repository).

---

## 6. INC-1 (P0 process incident) — RESOLVED

Running the DB-gated suites against the live Atlas `MONGO_URI` previously destroyed dev-database data. Root cause: unscoped `deleteMany({})` cleanup hooks. Fixed: cleanup scoped to each suite's own synthetic users; `dbTestHygiene.test.js` static guard + runtime INC-1 guard in all config/db suites (non-test databases → `dbUp=false`, DB tests skip). No unscoped `deleteMany({})` remains in any suite. No user-authored data was stored; this was executor error, not a product defect.

---

## 7. Remaining blockers and production prerequisites

1. **Production deployment:** Deploy a production-like HTTPS environment for production security verification (ENVIRONMENT PENDING).
2. **SEC-1 reassessment (2026-11-16):** Review whether either react-router advisory has become exploitable in Frieday's deployment context (no SSR, no user-controlled router input); if so, plan the v6→v7 migration.
3. **MongoDB Atlas production setup:** dedicated production cluster, least-privilege user, IP allowlist, backups (do not touch dev/Atlas data).
4. **GitHub OAuth App callback URL:** update to the production HTTPS origin in GitHub Developer Settings.

---

## 8. Phase status

| Phase        | Status     | Details                                                                                                                                                         |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 8 T8.1 | `[~]`      | Remaining: production-environment verification (ENVIRONMENT PENDING). All automatable acceptance gates PASS with evidence (937/0/1 server, exit 0).             |
| Phase 8 T8.2 | `[~]`      | Remaining: SEC-1 reassessment 2026-11-16 + production-environment verification. All automatable security gates PASS. SEC-1 is an approved exception, not a fix. |
| Phase 9      | **LOCKED** | Phase 8 DoD not fully met (production-environment verification pending).                                                                                        |

**No deployment, push, commit, or production-readiness claim has been made.** SEC-1 remains an approved time-bound exception with reassessment on 2026-11-16; it is not described as fixed.
