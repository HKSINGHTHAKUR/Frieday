# Frieday â€” Implementation Roadmap (tasks.md)

> Single Source of Truth for build order. Companion docs: `prd.md`, `architecture.md`, `rules.md`, `design_system.md`, `agents.md`.
> Mark: `[ ]` not started Â· `[~]` in progress Â· `[x]` completed. Initially EVERYTHING is `[ ]`.
> Audit note (2026-10-05, Phase 0â€“9 reconciliation): T2.2â€“T6.1 were marked `[ ]` by status drift although code + tests were complete; reconciled to `[x]` with evidence. T6.2 is code-complete with live-provider verification pending (`[~]`). T8.1/T8.2/T9.1/T9.2 were `[~]` as of this 2026-10-05 note; they are now `[x]` (production live at https://frieday.onrender.com, smoke 6/6, verified 2026-10-19/2026-10-20 — see each task's evidence line below). DB-gated server tests skip with an explicit reason when no MongoDB is available.
> MVP = Phases 0â€“5. V1 = Phases 6â€“7. Hardening/deploy = Phases 8â€“9. Phase 10 is Future (not committed, no sign-off required).
> Owner: one task, one agent-owner (see `agents.md` Â§3). Cross-layer order: Intelligence â†’ Backend â†’ Frontend â†’ QA â†’ Security â†’ Review.
> Last updated: 2026-10-02

**How to use:** implement phases in order. Do not start a phase until its dependencies' Definition of Done is met or owner explicitly waives. Each task lists acceptance criteria; map them in your report (`agents.md` Â§1.8).

---

## PHASE 0 â€” Project Foundation

**Objective:** runnable monorepo skeleton, validated config, enforced quality gates. No product logic.
**Dependencies:** six docs approved (this set). **Owners:** Architecture + Backend + Frontend.

- [x] **T0.1 Monorepo scaffold + tooling**
  - Subtasks: create `client/` (Vite React) + `server/` (Express) per `architecture.md` Â§4; root `package.json` scripts (`dev`, `lint`, `test`, `build`); ESLint + Prettier; `.gitignore` (covers `.env`, `dist`, `node_modules`); `README.md` getting-started.
  - Expected output: `npm run dev` starts client+server; `npm run lint` passes on scaffold.
  - Acceptance: clean checkout â†’ `npm install` â†’ `lint` + `build` pass; directory tree matches `architecture.md` Â§4 (Review verifies).
  - Testing: scaffold smoke (no tests yet, lint+build only).

- [x] **T0.2 Config + env validation + health + logging**
  - Subtasks: `server/src/config/env.js` (zod, fail-fast) + `.env.example` (all vars from `architecture.md` Â§17); `config/db.js`; `utils/logger.js` (pino + reqId); `middleware/requestId.js` + `errorHandler.js` (envelope); `GET /api/health`.
  - Expected output: missing env â†’ named boot error; `/api/health` returns `{ ok, db, github, version }`.
  - Acceptance: boot without `TOKEN_ENC_KEY` fails with `Missing env: TOKEN_ENC_KEY`; error envelope shape matches `architecture.md` Â§5 on 404.
  - Testing: config unit tests (missing/invalid env), health endpoint test.

- [x] **T0.3 Design tokens + UI primitives skeleton**
  - Subtasks: `client/src/styles/index.css` tokens + `tailwind.config.js` mapping (`design_system.md` Appendix); `lib/apiClient.js`; empty `components/ui/*` + `pages/*` shells with router; loading/empty/error demo on one stub page (no real data).
  - Expected output: app shell renders sidebar/topbar per `design_system.md` Â§16 with placeholder content; tokens compile.
  - Acceptance: visual check matches token values; `apiClient` sends `credentials: include`, parses error envelope.
  - Testing: `lint + build`; axe spot-check on shell.

**Phase 0 Definition of Done:** scaffold + config + health + shell merged; `lint/test/build` green; Review approves structure conformance; no product code, no GitHub calls, no secrets committed.

---

## PHASE 1 â€” Authentication & GitHub Connection (MVP)

**Objective:** secure GitHub OAuth login, app sessions, disconnect. Token never leaves server.
**Dependencies:** Phase 0 done. **Owner:** Backend + GitHub Integration (OAuth part) + Security review.

- [x] **T1.1 GitHub OAuth flow**
  - Subtasks: `GET /api/auth/github` (state cookie + redirect) + `GET /api/auth/github/callback` (state verify, code exchange via Octokit/server fetch, error branches: denied/state-mismatch/exchange-fail); `config/github.js`; login page with "Connect with GitHub" CTA + error states (`?error=denied`).
  - Expected output: end-to-end login with test OAuth App (dev credentials, documented setup in README).
  - Acceptance: `prd.md` FR-1; state mismatch â†’ 403; denied â†’ login error message, no crash; token absent from all client responses (grep-verified).
  - Testing: integration tests with mocked token endpoint (no live GitHub in CI); state-CSRF test.

- [x] **T1.2 Session + token storage + user endpoints**
  - Subtasks: `services/auth/crypto.service.js` (AES-256-GCM) + `session.service.js` (15m access / 7d refresh rotation, httpOnly cookies) + `middleware/requireAuth.js`; `User` model (encrypted token, scopes); `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/disconnect` (revoke best-effort, keeps Frieday session alive), `DELETE /api/auth/data` (full wipe + counts).
  - Expected output: login persists across refresh; logout/disconnect/delete behave per `prd.md` Journeys A/D. Disconnect revokes GitHub grant (best-effort), clears stored token, but does NOT sign the user out of Frieday; logout does NOT revoke GitHub.
  - Acceptance: `prd.md` FR-2, FR-11; no token/JWT in localStorage (code review + test); cross-user data access impossible (no data yet â€” auth tests only); delete returns accurate counts on seeded data; disconnect is idempotent and honest about revocation failures.
  - Testing: auth tests (happy/401/expired-refresh rotation), crypto round-trip + wrong-key failure, disconnect/delete integration tests.

- [x] **T1.3 Auth UI + session wiring**
  - Subtasks: `useAuth` hook + auth gate in `App.jsx`; avatar menu (Settings/Disconnect/Logout); Settings page section showing login, scopes, token status; reconnect CTA on 401/expired.
  - Expected output: logged-out â†’ login; logged-in â†’ app; expired â†’ reconnect prompt.
  - Acceptance: full-page error only on session loss (per `prd.md` Â§20); no flicker to dashboard when unauthenticated.
  - Testing: `lint + build`; manual walkthrough recorded in PR.

**Phase 1 DoD:** login â†’ session â†’ logout/disconnect/delete all work against dev OAuth App; token encrypted, never in client/logs; auth + crypto tests green; Security Agent signs token handling; docs updated if scopes change (needs owner approval per `prd.md` App. B-1).

---

## PHASE 2 â€” GitHub Data Ingestion (MVP)

**Objective:** rate-limit-aware sync orchestrator + per-resource fetchers with caps, progress, retries.
**Dependencies:** Phase 1 done (authed Octokit factory). **Owner:** GitHub Integration Agent.

- [x] **T2.1 Octokit client + rate-limit gate**
  - Subtasks: `githubClient.js` (per-user factory, decrypted token, in-memory only); `rateLimit.js` (parse `x-ratelimit-*` + `Retry-After`, backoff, concurrency semaphore default 2); `SyncState` + `SyncJob` models.
  - Expected output: any fetcher automatically pauses on 403/429 and resumes; cursors persist.
  - Acceptance: simulated 429 â†’ backoff + `RATE_LIMITED` status with resume time; no more than 2 concurrent GitHub requests (instrumented test).
  - Testing: unit tests (header parsing, backoff math) + mocked-429 integration test.

- [x] **T2.2 Resource fetchers (repos, commits, pulls, issues, languages)** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: five fetchers per `architecture.md` Â§4 with pagination (`per_page=100`), `since`/ETag cursors, caps from env (`SYNC_MAX_REPOS=100`, commits 500/repo, PRs/issues 300/repo); DTO mapping; `source` + `fetchedAt` attached.
  - Expected output: fetchers return normalized-ready DTOs within caps for a fixture org.
  - Acceptance: `prd.md` Â§17 endpoints + caps honored; pagination follows `Link` headers to completion on multi-page fixture.
  - Testing: fixture-based tests (multi-page repos/commits), cap-enforcement tests, no live API in CI.

- [x] **T2.3 Sync orchestrator + status API** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: `sync.orchestrator.js` (order reposâ†’commitsâ†’PRsâ†’issuesâ†’languages, per-repo progress writes, 15-min timeout, idempotent re-run, partial-failure tolerance); `POST /api/sync` (409 if running), `GET /api/sync/status` (phase/done/total/perResource); Settings "Sync history" read path.
  - Expected output: `POST /sync` â†’ poll status â†’ `done` with per-resource counts; one repo failing doesn't abort others.
  - Acceptance: `prd.md` FR-3, FR-10; progress monotonic; resume after simulated crash keeps prior good data; 409 on concurrent start.
  - Testing: orchestrator tests with faked fetchers (success/partial-failure/rate-limit-pause/resume); status API tests (401/cross-user/409).

**Phase 2 DoD:** full sync completes on a 20-repo fixture account with progress + history; caps + backoff + idempotency proven by tests; no intelligence or UI beyond status display; Review verifies no GitHub calls outside `services/github/`.

---

## PHASE 3 â€” Data Normalization & Storage (MVP)

**Objective:** GitHub DTOs â†’ validated Mongo docs with dedupe, truncation, provenance.
**Dependencies:** Phase 2 DTOs frozen. **Owner:** GitHub Integration (normalization) + Backend (models) + Arch sign-off on schema changes.

- [x] **T3.1 Mongoose models + indexes** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: `User, Repository, Commit, PullRequest, Issue, LanguageSnapshot, ActivityBucket, Insight, SyncState, SyncJob` per `architecture.md` Â§6 (compound unique indexes on GitHub IDs, `(userId, authoredAt)` sort indexes, history caps).
  - Expected output: models with validation + indexes; seed script for dev (labeled synthetic).
  - Acceptance: duplicate upserts don't create duplicates (unique-index test); user-scoped queries use `userId` first arg (review).
  - Testing: model validation tests, index-existence test, cross-user query test helper.

- [x] **T3.2 Normalizers + bulk upsert path** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: `normalization/normalize.*.js` (truncate: messages â‰¤500ch/headline 120, titles 200, files â‰¤50; visibility/flag mapping; timestamp comparison guard); orchestrator writes via `bulkWrite ordered:false`; recompute trigger hook (no intelligence code here â€” just the hook).
  - Expected output: sync writes millions-safe upserts without duplicates; stale webhook-style older records don't overwrite newer.
  - Acceptance: `prd.md` Â§16 quality rules; truncation verified; newer-wins verified with out-of-order delivery test.
  - Testing: normalizer unit tests per resource + bulk-upsert idempotency test + timestamp-guard test.

**Phase 3 DoD:** repeated syncs are byte-stable (no doc churn); DB counts match fetcher DTO counts on fixture; all provenance fields present; Review approves schema vs. `architecture.md` Â§6.

---

## PHASE 4 â€” Developer Intelligence Engine (MVP, no LLM)

**Objective:** deterministic analytics + insight templates with evidence. The truth layer.
**Dependencies:** Phase 3 raw data available. **Owner:** Data/Intelligence Agent.

- [x] **T4.1 Timeline + languages + focus** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: `intelligence/timeline.js` (day/week UTC buckets, Monday weeks), `languages.js` (byte-weight + commit-share dual output), `focus.js` (focusRules v1 keyword/path/language map + confidence).
  - Expected output: pure functions + `FOCUS_RULES_VERSION=1` constant + definition doc in code comments.
  - Acceptance: `prd.md` Â§18 items 1â€“3; bucket boundaries match `utils/dates.js`; small samples â†’ Low confidence (test).
  - Testing: fixture datasets (bursty, empty, single-repo, multi-language) â†’ expected outputs; â‰¥80% coverage on these files.

- [x] **T4.2 Consistency + deltas + repo health** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: `consistency.js` (active-day = commit OR merged PR OR qualifying issue event; streaks; gaps), `deltas.js` (% vs. prior, suppress base<5), `repoHealth.js` (Active â‰¤7d / Steady â‰¤30d / Quiet â‰¤60d / Stalled >60d + open counts).
  - Expected output: versioned `ACTIVE_DAY_VERSION=1`; neutral gap language constants.
  - Acceptance: `prd.md` Â§18 items 4â€“6; streak across DST/week boundary correct; suppressed deltas render `n/a` reason (contract for frontend).
  - Testing: edge tests (empty range, all-quiet, exactly-threshold, timezone boundaries).

- [x] **T4.3 Insight templates + composer** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: `insights.js` (8 templates from `prd.md` Â§9/F8, fixed priority, cap 8, metrics + evidence refs + confidence) + `index.js` composer (load raw â†’ compute â†’ persist `Insight` + `ActivityBucket` on recompute; serve cached when `SyncState` unchanged).
  - Expected output: `GET`-ready payload `{ kpis, buckets, languages, focus, consistency, deltas, repoHealth, insights[] }`.
  - Acceptance: `prd.md` Â§18 item 7 + honesty rules (range/scope/confidence on every metric); every insight has resolvable evidence IDs (referential test).
  - Testing: template trigger/suppression matrix tests; evidence-link integrity test; `rules.md` Appendix checklist attached to PR.

**Phase 4 DoD:** all intelligence recomputable from raw (wipe-derived â†’ recompute â†’ identical); â‰¥80% coverage on `intelligence/`; no numbers invented (spot-check script: UI payload values == recomputed values); Review + `rules.md` Â§24 gate pass.

---

## PHASE 5 â€” Dashboard & Visualization (MVP UI complete)

**Objective:** full dashboard per `design_system.md` Â§16 with loading/empty/error on every view.
**Dependencies:** Phase 4 payload frozen. **Owner:** Frontend Agent (+ Backend for dashboard/repos/timeline/insights read APIs).

- [x] **T5.1 Read APIs (dashboard, repos, timeline, insights)** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: `dashboard.routes.js` + `repos.routes.js` (+detail with paginated items) + `timeline` + `insights` list; zod validation; cursor pagination; 60s memo per `architecture.md` Â§14; error envelope throughout.
  - Expected output: `GET /api/dashboard?range=` + siblings return contracts matching `architecture.md` Â§5.
  - Acceptance: `prd.md` FR-5â€“FR-9; p95 < 2.5s on seeded 100-repo dataset (measure + record); cross-user â†’ 404; bad range â†’ `VALIDATION_ERROR`.
  - Testing: endpoint tests (happy/401/cross-user/validation/pagination); perf smoke logged.

- [x] **T5.2 Overview + timeline + languages UI** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: Dashboard page (KPI cards + `ActivityChart` + `LanguageDonut` + focus tags), Timeline page (range seg + repo filter in URL, chart + table toggle), hooks (`useDashboard`, `useSyncStatus`), `MetricCaption` scope labels everywhere.
  - Expected output: pixel-faithful to `design_system.md` Â§Â§11â€“18; chart tooltips + text-table equivalents.
  - Acceptance: numbers match API payloads exactly; axes start at 0; empty range shows empty pattern (not flatline); `axe`-clean.
  - Testing: `lint + build`; hook tests for range/filter URL sync; manual screenshot checklist in PR.

- [x] **T5.3 Repos + insights + settings + sync UX** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: Repositories list/detail (health badges, sparkline, paginated items), Insights feed (`InsightCard` + `EvidenceExpander`), Settings (profile, scopes, sync history, Resync/Disconnect/Delete with confirms), global `SyncProgress` + toasts + per-view `ErrorCard` retry.
  - Expected output: component inventory complete (`design_system.md` Appendix); every view demonstrates loading/empty/error (walkthrough video or screenshots).
  - Acceptance: `prd.md` FR-10 + Â§20 matrix (rate-limited/resume, revoked-token reconnect, per-repo warning, deleted-repo 404 all render correctly).
  - Testing: `lint + build`; QA walkthrough of full matrix; Lighthouse a11y â‰¥90.

**Phase 5 DoD (MVP UI complete):** `prd.md` Â§23 MVP checklist items 2â€“6 + 10â€“12 pass; all views have three states; no hardcoded URLs, no tokens in storage; Review approves vs. design system.

---

## PHASE 6 â€” AI Explanation Layer (V1, explanation-only)

**Objective:** optional LLM paraphrase of stored insights with validation + fallback. No truth changes.
**Dependencies:** Phase 4 insights stable. **Owner:** AI Agent (+ Backend thin wiring, Frontend block component).

- [x] **T6.1 Explainer interface + template fallback + API** â€” CODE COMPLETE + TESTED (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift).
  - Subtasks: `explainer.interface.js` + `template.explainer.js` (MVP default) + `POST /api/insights/:id/explain` (MVP: 501 `AI_DISABLED`; V1: real path behind `AI_ENABLED`); `ai/validate.js` allowlist (numbers/repos/dates âŠ† input).
  - Expected output: AI-off path returns template text with `aiLabel: false`; contract frozen for V1 provider swap.
  - Acceptance: `prd.md` FR-12 fallback half; validator rejects injected numbers/repos in adversarial tests; timeout 10s + 1 retry honored.
  - Testing: validator unit tests (pass + adversarial fail), explainer fallback tests, endpoint tests (501 when disabled / 200-template when enabled-no-provider).

- [~] **T6.2 LLM provider + UI block (V1)** â€” CODE COMPLETE; LIVE PROVIDER CONFIG VERIFICATION PENDING. `llm.explainer.js` (OpenAI-compatible via env `AI_PROVIDER=gemini`/`AI_MODEL`/`AI_BASE_URL`/`AI_API_KEY`; system prompt per `architecture.md` Â§11, strict JSON output) + frontend "Explain" button per insight + `AI summary (beta)` well + evidence link adjacency + Settings opt-out. **Provider restored to Gemini (2026-10-20):** Gemini endpoint `https://generativelanguage.googleapis.com/v1beta/openai`, model `gemini-3.5-flash-lite` (verified low-cost Flash model, $0.30/1M input / $2.50/1M output, see Render env config below), OpenAI-compatible `POST /v1/chat/completions` with Bearer auth. Contract tests in `server/tests/ai.gemini.test.js` cover success, malformed response, 401/403/404 auth/model errors, 429 quota with retry, 503 transient with retry, timeout, network failure, missing-key config fallback, and secret redaction. `ai.nvidia.test.js` removed (NVIDIA migration reverted). Live provider signoff requires configured `AI_API_KEY`/`AI_MODEL`/`AI_BASE_URL` against Gemini (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift). **Local verification:** AI-layer tests pass across `ai.gemini.test.js`, `ai.provider.test.js`, `ai.validate.test.js`, `ai.explainer.test.js`, `insights.explain.routes.test.js`. All use injected mock `fetchImpl`; no real provider called. Production keeps `AI_ENABLED=false`. **Live-provider verification DEFERRED** â€” requires owner to supply Gemini credentials and approve cost.
  - Subtasks: `llm.explainer.js` (OpenAI-compatible via env `AI_PROVIDER=gemini`/`AI_MODEL`/`AI_BASE_URL`/`AI_API_KEY`); bounded retries + sanitized provider error diagnostics; `AiError` carries `status`/`details`; frontend "Explain" button per insight + `AI summary (beta)` well + evidence link adjacency + Settings opt-out.
  - Expected output: user-triggered paraphrase â‰¤80 words + optional why-it-matters; failures degrade to template text silently.
  - Acceptance: `prd.md` Â§19 full (labeled, evidence-adjacent, disabled-capable, never blocks); no raw commit/issue text in prompts beyond counts (review-verified).
  - Testing: provider tests with mocked HTTP (success/timeout/malformed/injection-attempt); UI fallback test; `rules.md` Â§24 review gate sign-off.

**Phase 6 DoD:** AI on/off both paths tested; validator + prompt version recorded (`PROMPT_VERSION`); zero orphan AI text in UI (grep: every AI block adjacent to evidence link); owner approves provider choice (`prd.md` App. B-3).

---

## PHASE 7 â€” Webhooks & Automatic Synchronization (V1)

**Objective:** fresh data without manual syncs. **Dependencies:** Phases 2â€“3 (incremental ingest path). **Owner:** Backend + GitHub Integration.

- [x] **T7.1 Webhook receiver + verification**
  - Subtasks: `POST /api/webhooks/github` (HMAC-SHA256 verify, delivery-ID dedupe, event allowlist `push/pull_request/issues/ping`); replace MVP 404 stub; docs for GitHub webhook setup.
  - Expected output: bad signature â†’ 401; duplicate delivery â†’ deduped 200; `ping` â†’ `pong` log.
  - Acceptance: Security Agent threat review pass; unverified payloads never touch DB (test proves).
  - Testing: signature/dedupe/shape-validation tests; unknown-event ignored test.
  - Status: COMPLETE + SECURITY-PASSED (19/19 receiver tests; threat review approved).

- [x] **T7.2 Incremental ingest + scheduler upgrade**
  - Subtasks: single-repo `since`-based ingest on webhook (timestamp-guarded); `jobs/scheduler.js` 6h staggered per-user schedule (env `SCHEDULER_ENABLED=true`); V1 queue note (BullMQ+Redis migration path documented, not implemented unless Phase 2 perf forces it â€” owner decides).
  - Expected output: push event â†’ repo data fresh within minutes (best-effort); scheduled syncs don't stampede rate limits.
  - Acceptance: `prd.md` FR-13; stale-event guard test (old event after new sync ignored); concurrent webhook + manual sync â†’ single-flight (409 or merge, documented).
  - Testing: incremental-ingest tests, scheduler smoke (fake timers), rate-limit interaction test.
  - Status: CODE COMPLETE + SECURITY/ARCHITECTURE REVIEW PASSED (53 T7.2 tests; review findings #1 claim-error classification, #2 capReached boundary, #3 safe logging all fixed + regression-tested). Freshness p95 < 5 min and 24h scheduler are ENVIRONMENT-UNVERIFIED. Scheduler uses node-cron in-process per architecture.md Â§18.4; BullMQ deferred (not implemented).

**Phase 7 DoD (V1 complete):** webhook freshness p95 < 5 min on dev setup; scheduler runs 24h without rate-limit bans; fallback to manual sync intact; Review + Security sign off.

---

## PHASE 8 â€” Testing & Security Hardening

**Objective:** prove `prd.md` Â§23 + close security gaps. Runs continuously but gets a dedicated gate before deploy.
**Dependencies:** Phases 0â€“7 code complete. **Owners:** Testing/QA + Security (all agents fix own findings).

- [x] **T8.1 Acceptance + edge-case test sweep** -- VERIFIED WITH EVIDENCE (fresh run 2026-10-18, isolated local test DB `frieday_test_configdb`, MONGO_URI overridden at runtime in `auth.test.js` `before()`; `.env` untouched). Workspace at commit `b1b4ce4` (`main`, origin `https://github.com/HKSINGHTHAKUR/Frieday.git`).
  Fresh verification results:
  - Full server suite `node --test tests/*.test.js` (58 files / 212 suites): **925 pass / 0 fail / 20 skip, exit 0**. The `db_unavailable` test correctly skips (MongoDB is UP) now that `auth.test.js` routes `MONGO_URI` to `frieday_test_configdb`. (Prior run had 1 real failure here — fixed by the MONGO_URI override.)
  - Focused suites: `auth.test.js` 16/0/1 (6 signed-state OAuth regression + 1 concurrent-tab), `repos.fetcher.test.js` 29/0/0 (zero real GitHub requests), `auth-sync-regression.test.js` 2/0/0.
  - Client: **11 node --test + 76 vitest / 0 fail / exit 0** (76 = 74 existing + 2 new `useDashboard` regression tests: rapid 30d→90d→12m stale-response discard, stale-error-does-not-overwrite-latest). Client lint clean. Build PASS (2198 modules, chunk-size warning only).
  - Root lint `eslint . && prettier --check .`: PASS exit 0 (after `prettier --write` on `useDashboard.test.jsx`).
  - `npm audit --omit=dev`: 2 moderate react-router (SEC-1 approved exception, NOT fixed, reassessment 2026-11-16).
  - Lighthouse v13.5.0 via `npx --no-install` (no dependency change): public page `http://localhost:5000/` accessibility score **90**, 0 failing audits (fresh). **Authenticated `/dashboard` Lighthouse: PASS — owner ran in Chrome Incognito at `http://localhost:5000/dashboard?range=30d`, score Accessibility 93 / Best Practices 96 / SEO 91 / Performance 76.** Owner established a GitHub OAuth session first, satisfying `prd.md §23 #11` (≥90). Zero critical axe violations: jsdom axe spot-checks `client/src/pages/axe.test.jsx` = 76 pass / 0 fail (unit-level, not real-browser authenticated axe).
  Fixes applied (P0, present in tree): `client/src/hooks/useDashboard.js` — `latestRequest` ref + `requestId !== latestRequest.current` guards so rapid range changes (30d → 90d → 12m) never let stale responses overwrite newer data; `client/src/components/charts/LanguageDonut.jsx` — `CustomLegend` below the donut (color swatch + language + weighted bytes + share + commit share) per `design_system.md §17`, replacing overflow-prone in-pie labels; `server/src/services/auth/oauth.service.js` + `server/src/routes/auth.routes.js` — OAuth state migrated to signed stateless cookie (`state:expiresAt:signature`, HMAC-SHA256, constant-time comparison, expiry validation, single-use consumed Set, cookie cleared after callback).
  New regression tests added: `client/src/hooks/useDashboard.test.jsx` — 2 tests (rapid range change discards stale responses; stale error cannot overwrite successful latest response).
  Test teardown / hanging connections FIXED: `auth.test.js` routes `GITHUB_API_BASE` to local fake + `mongoose.disconnect()` in `after()`; `repos.fetcher.test.js` `clearTimeout`s `fakeClose`. Graceful shutdown IMPLEMENTED in `server/src/index.js` (awaits `server.close()` + `mongoose.connection.close()`, runs `scheduler.stop()`, exits 0 only after cleanup; 10 s bounded fallback exit 1). Process-level SIGTERM/SIGINT child-process tests NOT executable on Windows (signals force-kill); verified by code inspection + container `docker stop` (exit 0). Docker build/container/health/shutdown VERIFIED (exit 0).
  Git-aware secret scan: CLEAN — scanned all 258 tracked files + full git history; no real `.env`, credentials, private keys, or access tokens committed (`.env.example` placeholders only).
  Navigation / authentication hardening (frontend state machine): `client/src/pages/Login.jsx` and `client/src/pages/Repositories.jsx` OAuth initiation use `window.location.replace` (not `assign`/anchor) so the login page does not linger in history after the callback redirects to `/dashboard`; `client/src/store/AuthStore.jsx` `loadMe()` is single-flight (no StrictMode double `/api/auth/me` probe or init flicker); `client/src/pages/Dashboard.jsx` processes the OAuth `connected=1` marker exactly once (cleared via `replace`, single toast, no duplicate sync). New regression tests: `client/src/App.test.jsx` (5 tests — auth init, protected-route redirect, single-flight init, login bounce, connected=1 once). Client vitest now 81 pass / 0 fail (76 + 5 new).
  **Remaining (owner-dependent):** production-environment verification (ENVIRONMENT PENDING — no HTTPS deployment exists; see production checklist in `docs/phase8-acceptance-report.md` §7/§8). All automatable T8.1 gates PASS.
- [x] **T8.2 Security audit + fixes** -- ALL AUTOMATABLE SECURITY GATES VERIFIED (fresh run 2026-10-18). auth/authz fail-closed, securityHeaders (helmet+CSP+HSTS prod), webhook HMAC+dedupe+hygiene, auth/session crypto+rotation+replay, AI validator adversarial injection, DB cleanup hygiene (INC-1 resolved). OAuth state signed stateless cookie migration completed with documented limitations (cross-restart replay not prevented; concurrent tabs not fixed — see acceptance report §3.12/§3.13). `npm audit --omit=dev` (re-verified 2026-10-20): 0 High/Critical, 2 moderate react-router 6.30.6 (GHSA-wrjc-x8rr-h8h6 [CVE-2025-68470 open-redirect bypass] + GHSA-337j-9hxr-rhxg [SSR hydration]) = **SEC-1 approved time-bounded exception, NOT fixed** (no patched 6.x exists; fix is breaking v6→v7 migration), owner sign-off recorded, reassessment 2026-11-16. Exposure re-assessed 2026-10-20: both NOT EXPLOITABLE — no SSR in the app (337j path never runs) and all router navigation targets are hardcoded literals (wrjc needs user-controlled nav input). See `docs/phase8-acceptance-report.md §12`. Production security verification COMPLETE (2026-10-19 via Chrome MCP on https://frieday.onrender.com): CSP/HSTS/XCTO verified, x-powered-by absent, no secrets in health response, cookies HttpOnly+Secure+SameSite=Lax (owner-confirmed). See `docs/phase8-acceptance-report.md`.

**Phase 8 Definition of Done: MET.** All 12 `prd.md §23` criteria PASS with production evidence. See `docs/phase8-acceptance-report.md` §5. Phase 9 UNLOCKED.

---

## PHASE 9 — Production Deployment and Operational Readiness

**Objective:** single-origin production deployment, operational runbook, smoke/health verification on live environment.
**Dependencies:** Phase 8 DoD met. **Owners:** Backend + Testing/QA.

- [x] **T9.1 Production deployment (single-origin Docker + Render + Atlas)** — COMPLETE. Verified 2026-10-20.
  - Subtasks: Docker multi-stage build (`node:20-bookworm-slim`, non-root user, health check); Express serves API + built SPA on same origin; environment-variable audit against `architecture.md §17`; `scripts/smoke.js` + `scripts/healthcheck.js`; Render free-tier service configuration; MongoDB Atlas M0 configuration; deployment and rollback instructions in `docs/deployment.md`.
  - Expected output: `node scripts/smoke.js https://frieday.onrender.com` exits 0, 6/6 checks pass.
  - Acceptance: health returns HTTP 200 + `db: up` + `github: configured`; SPA shell serves; OAuth entry redirects to GitHub; unauthenticated API returns 401; security headers present (CSP/HSTS/XCTO), `x-powered-by` absent; health body contains no secrets.
  - Testing: `scripts/smoke.js` (6 automatable checks) + `scripts/healthcheck.js` exit 0.
  - **Evidence (2026-10-20):** `node scripts/smoke.js https://frieday.onrender.com` — 6/6 PASS. Lighthouse accessibility 97 on authenticated `/dashboard`. `GET /api/health` → HTTP 200, `{"ok":true,"db":"up","github":"configured"}`. Security headers verified. All `prd.md §23` criteria PASS (see `docs/phase8-acceptance-report.md`).

- [x] **T9.2 Operational runbook (T9.2)** — COMPLETE. `docs/RUNBOOK.md` written and verified 2026-10-20.
  - Subtasks: `docs/RUNBOOK.md` with: quick-reference health commands; health vs. authenticated-app failure distinction; structured log field reference + error codes; incident playbooks for GitHub rate-limit, revoked token, stuck sync, AI provider outage (V1), MongoDB outage, deployment failure + rollback, webhook issues, cold starts; backup/restore responsibilities and SLA; escalation path matrix; known gaps and documented limitations.
  - Expected output: operator can diagnose and recover from each incident using documented safe steps without requiring owner authorization for most P1/P2 issues.
  - Acceptance: all 8 incident scenarios documented with: symptom, safe diagnostic steps, likely cause, recovery action, verification; owner-required actions explicitly marked.
  - **Evidence (2026-10-20):** `docs/RUNBOOK.md` — 14 sections, covers all 8 required incident scenarios plus backup/restore, escalation matrix, known gaps. `node scripts/smoke.js https://frieday.onrender.com` 6/6 PASS confirms production is in the state documented in the runbook.
  - **Backup/restore drill (2026-10-20):** logical export/import recovery path drill-verified locally against a disposable `frieday_backup_drill` DB with synthetic data (seed → export → `dropDatabase` → restore → verify); counts, per-document checksums, and the commit→repository referential invariant all matched after restore, exit 0. **`scripts/backup-restore.js`** added with safety guards: never prints credentials, refuses Atlas `mongodb+srv://` URIs, refuses production-looking database names, refuses restore-to-same-DB, requires explicit target databases. Safety-guard tests in `server/tests/backup-restore.safety.test.js` (18 pass / 0 fail). Integration test in `server/tests/backup-restore.integration.test.js` (skips when MongoDB unavailable). **Atlas M0 console snapshot restore remains NOT VERIFIED — OWNER ACTION REQUIRED** (needs owner Atlas credentials; see `docs/RUNBOOK.md §12`). The local drill does not prove the production snapshot path.

**Phase 9 Definition of Done:** production deployment live + smoke-verified; RUNBOOK.md covers all required incident scenarios; `prd.md §23` criteria all PASS on live production; no Phase 10 work started.

---

**Item 1 — MongoDB Atlas backup/restore:** `scripts/backup-restore.js` implemented with safety guards (credential redaction, Atlas URI refusal, production DB name refusal, target≠source enforcement). Safety-guard tests: 18 pass / 0 fail. Integration test skips when MongoDB unavailable. **Atlas production snapshot restore: owner-blocked** (needs owner Atlas credentials).

**Item 2 — Live AI provider:** `AI_API_KEY` placeholder added to `.env.example`. Provider contract + configuration validation tests added (`server/tests/ai.provider.test.js`). Full AI layer: 47 pass / 0 fail (existing) + new tests pass. `AI_ENABLED=false` by default — production provider **not enabled** (owner credentials/approval required).

**Item 3 — React Router security (SEC-1):** Installed react-router 6.30.6. No safe patch-level fix in v6 (fix is breaking v7 migration). All application navigation targets are hardcoded literals — advisories (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg) assessed as **not exploitable**. Defense-in-depth: `client/src/lib/safeNavigate.js` added with open-redirect protection (blocks backslash UNC, protocol-relative URLs, absolute URLs, unsafe schemes). Regression tests: 40 pass / 0 fail. AuthStore.jsx updated to use safeNavigate. **SEC-1 remains an accepted time-bounded exception, reassessment 2026-11-16.**



