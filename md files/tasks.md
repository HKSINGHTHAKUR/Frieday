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

- [~] **T6.2 LLM provider + UI block (V1)** â€” CODE COMPLETE; LIVE PROVIDER CONFIG VERIFICATION PENDING. `llm.explainer.js` (OpenAI-compatible via env `AI_PROVIDER=gemini`/`AI_MODEL`/`AI_BASE_URL`/`AI_API_KEY`; system prompt per `architecture.md` Â§11, strict JSON output) + frontend "Explain" button per insight + `AI summary (beta)` well + evidence link adjacency + Settings opt-out. **Provider restored to Gemini (2026-10-20):** Gemini endpoint `https://generativelanguage.googleapis.com/v1beta/openai`, model `gemini-3.5-flash-lite` (verified low-cost Flash model, $0.30/1M input / $2.50/1M output, see Render env config below), OpenAI-compatible `POST /v1/chat/completions` with Bearer auth. Contract tests in `server/tests/ai.gemini.test.js` cover success, malformed response, 401/403/404 auth/model errors, 429 quota with retry, 503 transient with retry, timeout, network failure, missing-key config fallback, and secret redaction. `ai.nvidia.test.js` removed (NVIDIA migration reverted). Live provider signoff requires configured `AI_API_KEY`/`AI_MODEL`/`AI_BASE_URL` against Gemini (reconciled by Phase 0â€“9 audit 2026-10-05; was `[ ]` due to status drift). **Local verification:** AI-layer tests pass across `ai.gemini.test.js`, `ai.provider.test.js`, `ai.validate.test.js`, `ai.explainer.test.js`, `insights.explain.routes.test.js`. All use injected mock `fetchImpl`; no real provider called. **Production AI status (owner-reported, 2026-10-20):** the owner reports the Gemini Explain flow is working in production after setting the Render env vars; the agent has NOT independently observed a live provider response, so live-provider verification remains owner-asserted rather than agent-verified. The repository default stays `AI_ENABLED=false` (no credential in code or committed files). **Live-provider verification DEFERRED** â€” requires owner to supply Gemini credentials and approve cost.
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
  - Redelivery verification (2026-10-20): **AUTOMATED VERIFIED, LIVE REDELIVERY NOT VERIFIED.** `server/tests/webhook.ingest.test.js` + `server/tests/webhooks.routes.test.js` re-run — **29/29 pass**, covering HMAC verification (invalid / missing / malformed-prefix / non-hex / tampered-body / unicode-raw-bytes → 401 with **zero** store or handler calls), delivery-ID dedupe (duplicate processed once; race-safe under concurrent duplicates), cross-user isolation (one sync per owning user; payload `userId` never trusted; unmapped repos skipped), stale-event guard, and no secret/payload echo in any response. A live GitHub webhook redelivery was **not** triggered — it is an external state-changing action with no demonstrated need for the Phase 10.1 feature, and would require the owner's GitHub webhook UI.

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
  - **Backup/restore drill — prior local run (2026-10-20, kept for history):**
  mongodump backup of local database `frieday` at
  `C:\Users\harsh\Downloads\mongodb-database-tools-windows-x86_64-100.19.1\mongodb-database-tools-windows-x86_64-100.19.1\bin\dump\frieday\`
  restored to disposable `frieday_restore_check` (all 11 collections,
  indexes, counts verified; temp DB dropped). This proved the tooling but
  did NOT contain production data.
  - **Production recovery drill (`frieday_prod`) — VERIFIED COMPLETE (2026-10-20):**
  `mongodump 100.19.1` run against Atlas (`frieday.klryq5o.mongodb.net`,
  database `frieday_prod`) with the URI read from local `.env` and never
  logged. Dump written to `C:\Temp\frieday_prod_backup_20261020103600\`
  (11 BSON + 11 metadata.json + prelude.json; mongodump exit 0). Restored
  to isolated local database `frieday_prod_restored_20261020103600` via
  `mongorestore --nsFrom="frieday_prod.*" --nsTo="frieday_prod_restored_20261020103600.*"`
  (no `--drop`; 1316 docs restored, 0 failures). Verification: all 11
  collection names match; per-collection document counts match for every
  collection (activitybuckets=906, commits=341, insights=23, repositories=14,
  languagesnapshots=14, syncjobs=12, syncstates=5, users=1, issues=0,
  pullrequests=0, webhookdeliveries=0; total 1316); all index names, keys,
  and unique flags match source metadata.json for every collection. Isolated
  database dropped after verification; backup files retained locally
  (excluded from Git). Atlas production database `frieday_prod` was never
  written to. Safety-guard tests in
  `server/tests/backup-restore.safety.test.js`: **18 pass / 0 fail**.
  Integration drill test (`backup-restore.integration.test.js`): **2 pass /
  0 fail**. The in-repo script's Atlas-refusal guard is intentionally kept
  (Atlas backups are performed by the owner-tooling path documented in
  `docs/RUNBOOK.md §12`, not by `scripts/backup-restore.js`).

**Phase 9 Definition of Done:** production deployment live + smoke-verified; RUNBOOK.md covers all required incident scenarios; `prd.md §23` criteria all PASS on live production; no Phase 10 work started.

---

**Item 1 — MongoDB Atlas backup/restore:** `scripts/backup-restore.js`
implemented with safety guards (credential redaction, Atlas URI refusal,
production DB name refusal, target≠source enforcement). Safety-guard tests:
18 pass / 0 fail. Integration test: 2 pass / 0 fail. **Production
`frieday_prod` recovery drill — VERIFIED COMPLETE (2026-10-20):** full
`mongodump` from Atlas (`frieday.klryq5o.mongodb.net/frieday_prod`,
URI never logged) to `C:\Temp\frieday_prod_backup_20261020103600\`
(mongodump exit 0; 11 BSON + 11 metadata.json). `mongorestore` with
namespace remap `frieday_prod.*` → `frieday_prod_restored_20261020103600.*`
to local `127.0.0.1:27017` (no `--drop`): 1316 documents restored, 0
failures. All 11 collection names, document counts (906+341+23+14+14+12+5+1+0+0+0),
and index definitions (names, keys, unique flags) verified identical
between source dump and restored DB. Isolated restore dropped after
verification; Atlas was never written to. The script's Atlas URI refusal
is deliberately preserved — production backups use `mongodump` directly
per `docs/RUNBOOK.md §12`.

**Item 2 — Live AI provider:** `AI_API_KEY` placeholder added to `.env.example`. Provider contract + configuration validation tests added (`server/tests/ai.provider.test.js`). Full AI layer: 47 pass / 0 fail (existing) + new tests pass. `AI_ENABLED=false` by default (repository default; no credential committed). Production AI is **OWNER-CONFIRMED working** via Render env vars (2026-10-20) — the owner reports live Gemini responses are working. This is **owner-asserted, not independently agent-verified** (no live provider call was made by the agent; a live call would consume quota). Live-provider verification status: **OWNER-CONFIRMED**.

**Item 2b — GitHub sync freshness (< 5 min):** **OWNER-CONFIRMED working** (2026-10-20). The agent did not trigger a production sync to avoid a needless state-changing action. Freshness is visible in production: the sidebar status shows "Last synced 5m ago" and the Dashboard SyncProgress banner shows "Sync complete — All connected resources are up to date."

**Item 3 — React Router security (SEC-1):** Installed react-router 6.30.6. No safe patch-level fix in v6 (fix is breaking v7 migration). All application navigation targets are hardcoded literals — advisories (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg) assessed as **not exploitable**. Defense-in-depth: `client/src/lib/safeNavigate.js` added with open-redirect protection (blocks backslash UNC, protocol-relative URLs, absolute URLs, unsafe schemes). Regression tests: 40 pass / 0 fail. AuthStore.jsx updated to use safeNavigate. **SEC-1 remains an accepted time-bounded exception, reassessment 2026-11-16.**

---

## Phase 10 — Developer Intelligence Platform (post-MVP/V1)

### Phase 10.1 — Commit-theme clustering + dashboard UI repair

- [x] **T10.1 Deterministic commit-theme clustering** — COMPLETE (accepted 2026-10-20).
  - Subtasks: `server/src/services/intelligence/theme-rules.js` (taxonomy: explicit conventional prefixes + exact lowercase token lists per theme, documented `THEME_PRIORITY` conflict order, maintenance/noise signal lists, confidence thresholds, bounded-evidence limits) + `server/src/services/intelligence/themes.js` (pure classifier: `computeThemes({ commits, repositories })` → `{ version, rulesVersion, totalCommits, themedCommits, unclassified, noMessage, noise, items[] }`; `THEME_RULES_VERSION = 1`, `THEME_OUTPUT_VERSION = 1`) + composer wiring (cache-hit and recompute paths, reusing the already-loaded user-scoped commits — no extra query, no persistence) + `client/src/components/domain/CommitThemesCard.jsx` (Dashboard right column) + `server/tests/themes.test.js` + `client/src/components/domain/CommitThemesCard.test.jsx` + `client/src/pages/Dashboard.themes.test.jsx`.
  - Themes (7): Bug fix, Security, Performance, Testing, Documentation, Refactor, Feature. Buckets: theme / `unclassified` / `noMessage` / `noise`.
  - Matching: conventional prefix wins over tokens (`fix:` → Bug fix, `feat:` → Feature, `refactor:` → Refactor, `perf:` → Performance, `test:` → Testing, `docs:` → Documentation). Keyword conflicts resolve through the documented `THEME_PRIORITY`, not word order. Exact token match only — `fix` never matches inside `prefix`, `auth` never inside `authentic`. Commit bodies (`messageFull`) are **not** scanned in v1.
  - Denominator: theme percentages are over **themed commits only**; the UI always displays it. Counts reconcile: `totalCommits = themedCommits + unclassified + noMessage + noise`.
  - Confidence: reuses the established intelligence semantics (High ≥10 commits AND ≥2 repos; Medium ≥5 commits; else Low).
  - Evidence (bounded, server-side): ≤20 commit SHAs, ≤5 headline samples, ≤10 repo names. Commit bodies are never exposed.
  - Acceptance: `prd.md` §12.1 + §12.1 honesty constraints. No theme without confidence + evidence. No default theme when nothing qualifies. `THEME_RULES_VERSION`/`THEME_OUTPUT_VERSION` exported and asserted. No new dependency, no new model, no new endpoint, no change to existing focus/language calculations or insight ordering. No skill/intent claim in UI copy.
  - Testing: `server/tests/themes.test.js` — 68 pass / 0 fail (version constants, taxonomy structure, prefix/token disjointness, empty + degenerate input, noMessage, conventional-prefix precedence, exact token boundaries, all seven categories, ambiguous-keyword priority, noise/maintenance, unclassified, one-theme-per-commit, confidence threshold boundaries, percentage denominator, count reconciliation, evidence limits, determinism, input-order independence, input immutability, truncated headlines, no default theme). `client/src/components/domain/CommitThemesCard.test.jsx` — 14 pass / 0 fail (denominator, counts, confidence badges, repos, samples, non-theme buckets, empty/null states, long labels, zero counts, single theme, a11y list role). `client/src/pages/Dashboard.themes.test.jsx` — 5 pass / 0 fail (card present with denominator, honest empty state, no-themes payload, Focus areas + themes coexist, focus empty state independent).
  - Evidence (2026-10-20): server suite 1079 tests → 1055 pass / 0 fail / 24 skip (DB-gated skips, not passes); theme suites 70/70 pass; client suite 146 pass / 0 fail (16 files); lint PASS; production build PASS.
  - **ACCEPTED (2026-10-20, owner sign-off).** All 10 acceptance criteria met: (1) 7 documented themes with auditable literal rules — `theme-rules.js`; (2) conventional prefix beats tokens, keyword conflicts resolve via documented `THEME_PRIORITY` — `themes.js:122-140`; (3) one theme per commit — single `buckets.get(theme)` write, asserted by test; (4) percentages over themed-commits denominator, denominator rendered — `CommitThemesCard.jsx`; (5) reconciliation `totalCommits = themed + unclassified + noMessage + noise` — asserted by test, live production payload verified (43 + 38 + 0 + 2 = 83); (6) empty/low-data states show "No commit themes detected" / "Not enough commit-message detail" — never a fabricated distribution; (7) evidence bounded (≤20 SHAs, ≤5 headline samples, ≤10 repos), `messageFull` never scanned or exposed — asserted by test; (8) computed on demand from the already-loaded user-scoped commits — no extra query, no persistence, no new model; cross-user isolation asserted by `composer.themes.test.js`; (9) `THEME_RULES_VERSION` / `THEME_OUTPUT_VERSION` exported + asserted, 68 unit + 2 composer + 14 card + 5 dashboard tests; (10) live card verified in production DOM at 1440/768/390/320px — readable, no horizontal scroll. `rules.md` Appendix checklist complete: numbers trace to `themes.test.js`; UI shows range + confidence; no new GitHub calls; no LLM calls; no new endpoints (no auth changes); loading/empty/error states present; no config change (`config/env.js` + `.env.example` unchanged — Phase 10.1 added no env vars); `lint && test && build` output pasted above.

- [x] **T10.2 Dashboard + profile-menu UI repair** — COMPLETE (accepted 2026-10-20).
  - Root causes found and fixed (not cosmetic tweaks):
    - **B1/B2 — Focus areas card overlapped by the Languages legend.** `LanguageDonut.jsx` applied its `h-[280px]` fixed height to the *outer* wrapper that contained BOTH the 220px chart and the legend, so the legend overflowed and painted over the next card. Fixed to the pattern `ActivityChart.jsx` already uses correctly: fixed height on the chart-only box, legend as a sibling. Legend rewritten as a single-column, aligned list (colour swatch + wrapping label + mono value line) with `role="list"`/`role="listitem"`; donut radius now percentage-based (`innerRadius="45%" outerRadius="78%"`) so it scales with the container instead of using fixed pixel radii.
    - **B3 — Account menu clipped on narrow viewports.** `AvatarMenu.jsx` used `w-44` (176px) minus 2×16px padding and 2×16px item padding → ~112px of usable width, but "Disconnect GitHub" needs ~119px, so it clipped. Widened to `w-56` with `max-w-[calc(100vw-32px)]`; items wrap rather than clip; `z-50` so it is never painted behind a card. No ancestor clips it (`PageShell` has no `overflow: hidden`).
    - **B4 — Horizontal overflow below ~900px.** The 248px sidebar was `shrink-0` and visible at every breakpoint, so at 320px only ~24px remained for content. Implemented the responsive contract that `design_system.md` §15/§27 already specified but the code never had: `Sidebar.jsx` is now `hidden sm:flex` — a 64px icon rail from 640px, expanding to the full 248px rail at 900px (`md`), hidden below 640px — `MobileNav.jsx` is a new slide-over with scrim, focus trap and focus return, and `Topbar.jsx` gained a hamburger plus a condensed sync button. `PageShell` gained `min-w-0` so wide children scroll inside the column instead of forcing page-level overflow. The Dashboard activity table gained `overflow-x-auto` (matching `RepoHealthTable`). Tailwind breakpoints were realigned to the documented `sm 640 / md 900 / lg 1200` (defaults were `md 768 / lg 1024`). **Release-review correction (2026-10-20):** the first implementation used `hidden md:flex` for the sidebar, which left a **navigation dead zone at 640–900px** (sidebar hidden, hamburger also hidden). Caught by rendering the page at 768px, not by the test suite. Fixed by making the sidebar a 64px icon rail from 640px up; verified at 640/768/900 that navigation is always present.
    - Two latent component bugs fixed while touching these files: `Button.jsx` and `Badge.jsx` spread `...rest` *after* their `className`, so any caller-passed `className` silently replaced the variant/size classes. Both now merge the incoming `className` instead.
  - Acceptance: no unintended horizontal overflow at 320 / 375 / 390 / 768 / 1024 / 1440px; cards stack below 900px; readable typography preserved; existing design tokens and shared components only; focus indicators, keyboard navigation, menu semantics, outside-click and Escape behaviour preserved; disconnect vs logout distinction unchanged.
  - **ACCEPTED (2026-10-20).** Live production verification (MCP + DOM, `https://frieday.onrender.com/dashboard`, commit `faac061`): no unintended horizontal scroll at 1440 / 768 / 390 / 320px (`documentElement.scrollWidth == clientWidth` at every width); sidebar 248px → 64px rail → hidden with hamburger, never absent (the 640–900px dead zone found at release review is fixed and re-verified at 768px); account menu inside the viewport at 390px (150→374, 0 clipped items); donut renders (5 sectors) with a clean aligned legend; Commit themes card readable at every width ("of 43 themed commits" denominator visible). Zero console errors/warnings; 3 network requests, all 304, zero failures.
  - **Follow-up fixed in `faac061`:** the Languages legend labelled `commitShare` (a commit **count** per `languages.js:45`) with a `%` sign, producing impossible values like "commit share 216.8%". Now rendered as a count (`216.8 commits`) in both legend and tooltip; regression test added. The 1200px centered content cap is the documented `design_system.md:117` layout, not a defect — verified symmetric at 1662px (107px each side).

### Phase 10.2 — Per-repository theme drill-down (IMPLEMENTED LOCALLY — remediated, awaiting owner review; NOT deployed)

**Recommendation: per-repository theme drill-down.** A per-repo breakdown of the
existing commit-theme classifier, surfaced on the existing Repositories page.

**Rationale (vs the other documented candidates):**

| Candidate | Assessment |
|---|---|
| **Per-repository theme drill-down** | **Recommended.** Reuses 100% of Phase 10.1 code (`themes.js` classifier + `theme-rules.js` taxonomy) and the already-ingested commits. Direct precedent: `focus.js` already ships `computeRepoFocusTags` (line 239) — the identical per-repo variant of the same classifier, so the architecture pattern already exists. No new data, no new model, no new endpoint. Answers the obvious next question after seeing a cross-repo theme: *"which repo is that in?"* |
| Theme history / trend comparison | Deferred. Requires a **time-series** of themes (persisted per bucket), i.e. a new stored aggregate + a backfill for existing history. New persistence, new model shape, more failure modes. `prd.md` §18 evidence-first favours the simpler drill-down first. |
| Theme evidence drill-down | Partially **already delivered** in v1 — the card already shows ≤5 headline samples, repo names, and ≤20 commit SHAs. A richer "show all commits" expander is a small polish item, not a phase. |

**User problem.** Phase 10.1 shows cross-repository themes ("Documentation 90.7%"). A developer cannot tell *which repository* produced them, and the Commits list already shows a repository's full message history — so the data is present but the connection is not exposed.

**In scope.** Per-repository theme list for the selected repository and the
selected range, using the same classifier, thresholds, precedence and honesty
copy. Confidence and denominator shown exactly as in Phase 10.1.

**Out of scope.** Cross-repo comparison UI, theme history/trends, new models,
persisted theme payloads, LLM involvement, new GitHub API calls, changes to the
existing cross-repo card.

**UI / interaction flow.** On the existing Repositories page, each `RepoRow`
gains a themes affordance. Selecting a repository opens a themes panel
(same pattern as the existing per-repo drill-downs) showing: the denominator
("of N themed commits"), the theme list with confidence badges and shares over
the themed-commit denominator, the non-theme buckets ("N unclassified · N
without a message · N maintenance"), the same disclaimer, and the bounded
headline samples. No new page, no new route — the Repositories page already
exists (`client/src/pages/Repositories.jsx`) and already renders per-repo rows.

**Backend / data.** `server/src/services/intelligence/themes.js` gains
`computeRepoThemes({ commits, repositories, repoId })` — the same
`classifyHeadline` path, filtered to one repo, exactly mirroring
`focus.js:239 computeRepoFocusTags`. The composer reuses the **already-loaded**
user-scoped commits (`composer-data.js` `loadRawData` already returns
`repositories` + `commits` for the user) — **no extra DB query**, no new model,
no persistence.

**API.** No new endpoint. The existing `GET /api/dashboard` payload gains a
`repoThemes` map keyed by `repoId` (or the Repositories page composes it from
the same payload). Prefer the latter if the payload size stays bounded;
otherwise a `GET /api/dashboard?range=…&repoId=…` variant of the same route
(reuses the existing 60s memo cache, which is already keyed by
`userId:range:lastSyncedAt`).

**Privacy / evidence constraints.** Identical to Phase 10.1 — user-scoped
commits only (the `userId` scope is applied in `loadRawData` before any
per-repo filter); evidence bounded (≤20 SHAs, ≤5 headline samples, ≤10 repo
names — a per-repo view needs ≤1 repo name); `messageFull` never scanned or
exposed; no raw commit text beyond the bounded headline samples; cross-user
isolation asserted by test.

**Empty / loading / error states.** Same three states as the cross-repo card:
loading skeleton, honest empty state ("No commit themes detected" + "Not enough
commit-message detail"), and an error card. A repository with commits but zero
themed commits shows the empty state, never a fabricated distribution.

**Test plan.** `server/tests/themes.test.js` — extend with per-repo variant
cases (filter correctness, denominator over that repo's themed commits, no
cross-repo leakage, bounds). `server/tests/composer.themes.test.js` — assert
the per-repo payload is present and user-scoped. `client/src/pages/Repositories.test.jsx` —
per-repo panel opens/closes, denominator shown, empty state, confidence badges,
no overflow at 320/390px. Coverage ≥80% on touched intelligence files per
`agents.md` §3.6.

**Acceptance criteria.** (1) Per-repo theme list uses the same classifier,
precedence, thresholds and honesty copy as Phase 10.1 — no second taxonomy.
(2) Percentages use that repository's themed-commit denominator and the
denominator is visible. (3) `totalCommits = themed + unclassified + noMessage + noise`
holds per repository. (4) No cross-repo data in a per-repo view. (5) Evidence
bounded as above; no `messageFull`. (6) No new DB query, model, endpoint, or
dependency. (7) All three UI states implemented. (8) `lint && test && build`
green; no horizontal overflow at 320/390/768/1024/1440px.

**File-level breakdown (proposed).**
| File | Change |
|---|---|
| `server/src/services/intelligence/themes.js` | add `computeRepoThemes({ commits, repositories, repoId })`; export it |
| `server/src/services/intelligence/composer.js` | compute per-repo themes from the already-loaded commits; add to payload |
| `server/src/services/intelligence/index.js` | export `computeRepoThemes` (no new module) |
| `client/src/components/domain/CommitThemesCard.jsx` | accept an optional `title`/`scope` prop so the same card renders per-repo (reused, not duplicated) |
| `client/src/components/domain/RepoRow.jsx` | add the themes affordance / open state |
| `client/src/pages/Repositories.jsx` | render the per-repo themes panel |
| `server/tests/themes.test.js` | per-repo variant unit tests |
| `server/tests/composer.themes.test.js` | per-repo payload + isolation test |
| `client/src/pages/Repositories.test.jsx` | per-repo panel UI tests |
| `md files/{prd,architecture,design_system,tasks}.md` | scope, contract, component inventory, task entry |

**Rollout / regression strategy.** Ship behind the existing per-repo drill-down
pattern (no feature flag needed — it is an additive read-only view). No
migration. Re-run the full server suite, client suite, lint and build. Then
**mandatory MCP browser verification** on the deployed site: open the
Repositories page, open a per-repo themes panel, and inspect the **live DOM** at
**1440×900** and **390×844** (plus 320×720) — confirm the denominator is
visible, the empty state renders honestly, the panel does not overflow the card
or the viewport, and the account menu + mobile nav still behave. Capture DOM
measurements (panel width, `documentElement.scrollWidth` vs `clientWidth`) and
screenshots for the PR, and re-verify the cross-repo card and the Languages
legend for regressions.

**Open decisions for the owner.**
1. Payload shape: `repoThemes` map inside the existing dashboard payload vs a
   `?repoId=` query on the same route. (Map is simpler; query keeps the
   payload small. Recommend the map, bounded to repos with themed commits.)
2. Should the per-repo panel live on the Repositories page (recommended) or as
   a sub-view of the Dashboard right rail?
3. Whether to also expose the theme shares of a single repo on the Repositories
   page summary row (e.g. top theme chip per repo) — nice-to-have, adds
   density.

---

**Owner-approved decisions (2026-10-20):** (1) `repoThemes` map in ONE
response; (2) the existing Repositories page; (3) a top-theme chip per
repository row. Implemented locally; **not committed, not pushed, not
deployed**.

**Implementation (2026-10-20, amended 2026-10-21).**
- `server/src/services/intelligence/themes.js` — added `computeRepoThemes({ commits, repositories, repoId })` (the per-repo variant, mirroring `focus.js` `computeRepoFocusTags` — same classifier, same taxonomy, same precedence), `computeRepoThemesMap({ commits, repositories })` (one map for a page), and `pickTopTheme(items)` (deterministic top-theme selection). Added a `scope` option to `computeThemes` so the per-repo confidence tier does not borrow the cross-repo "≥2 repositories" corroboration rule. **Amended 2026-10-21:** the item sort and `pickTopTheme` now share ONE comparator, `compareThemeItems` (confidence → commit count → `THEME_PRIORITY` → name), so the chip is by construction the first displayed row; malformed commit records (null / undefined / non-object) are skipped consistently in `computeThemes`, `computeRepoThemes` and `computeRepoThemesMap`.
- `server/src/services/repos/repos.service.js` — added `getCommitsByRepoIds(userId, repoIdStrings)`: user-scoped commits for the repos on the page, grouped by repo id. `getRepoHealthForIds` keeps its existing Map return contract (unchanged public surface) and now accepts the already-fetched commit map as an optional third argument. **Amended 2026-10-21:** the read is a single aggregation — `$match` (user + page) → `$project` (headline, sha, repoId, authoredAt; never `messageFull`) → `$sort` (authoredAt desc, sha asc) → `$group` by repoId → `$slice` to the 500-commit ceiling **after** the grouping. The per-repository window is therefore enforced independently for every repository, and the endpoint issues ONE commit query for both the health rule and the theme map.
- `server/src/services/repos/repos.controller.js` — `GET /api/repos` returns `repoThemes` (map keyed by repo id) when `includeThemes=true` is requested. Existing `items` / `nextCursor` / `hasMore` fields are unchanged, so existing consumers are compatible. **Amended 2026-10-21:** the theme map is opt-in, and the controller no longer duplicates the map builder — it delegates to `computeRepoThemesMap`.
- `client/src/hooks/useRepos.js` — exposes `repoThemes` from the same response and merges it across cursor pages. No extra request per repository. **Amended 2026-10-21:** the request carries `includeThemes=true`.
- `client/src/components/domain/RepoThemes.jsx` (new) — the top-theme chip + the drill-down toggle. The chip appears ONLY when the repository has ≥1 themed commit; a repository with none gets no chip and no affordance. **Amended 2026-10-21:** the toggle's accessible name names the repository ("synthetic/app: View themes") so two open panels are distinguishable, and the orphan screen-reader-only span was removed.
- `client/src/components/domain/RepoRow.jsx` — renders `RepoThemes` when a `repoThemes` entry is present; otherwise the row is byte-identical to before.
- `client/src/components/domain/CommitThemesCard.jsx` — accepts `scope="per-repo"` so the SAME card component renders the per-repo breakdown (denominator, confidence badges, buckets, disclaimer, samples). Heading id is scope-derived so the cross-repo and per-repo cards can coexist without duplicate ids. **Amended 2026-10-21:** the per-repo heading's accessible NAME also names the repository (two open panels are two distinct landmarks, not two identically-named ones), and the sample-commit list no longer uses the message text as its React key.
- `client/src/pages/Repositories.jsx` — passes `repoThemes?.[repo.id]` to each row.
- `client/src/pages/Timeline.jsx` — **unchanged**; it keeps calling `GET /api/repos` without `includeThemes`, so it no longer pays for the map it discards.

**API contract.** `GET /api/repos?sort=&limit=&cursor&includeThemes=true` response:

```jsonc
{
  "items": [ /* unchanged */ ],
  "nextCursor": null,
  "hasMore": false,
  "repoThemes": {          // present ONLY when includeThemes=true
    "<repoId>": {
      "version": 1, "rulesVersion": 1,
      "totalCommits": 34,        // total = themed + unclassified + noMessage + noise
      "themedCommits": 28,       // the denominator for percentages
      "unclassified": 4, "noMessage": 0, "noise": 2,
      "items": [ { "theme": "Bug fix", "confidence": "High", "commitCount": 20,
                   "share": 0.714, "evidence": { "repoNames": ["me/alpha"],
                   "commitShas": ["a1"], "sampleMessages": ["fix: crash in parser"] } } ],
      "topTheme": { "theme": "Bug fix", "commitCount": 20, "share": 0.714, "confidence": "High" }
    }
  }
}
```
`includeThemes` is opt-in (default `false`): the map is 85% of the response bytes for a small page and 94% for a 50-repo page, and only the Repositories page uses it. A malformed value returns 400 `VALIDATION_ERROR`. When the map is requested, every repository on the page gets an entry (empty payload + `topTheme: null` when it has no commits), so the map is a complete, stable index. `messageFull` is never read or exposed; evidence stays bounded (≤20 SHAs, ≤5 headline samples).

**Testing (2026-10-21, remediation pass).** `server/tests/themes.test.js` 93 pass / 0 fail (68 Phase 10.1 + 15 Phase 10.2 + 10 added by the remediation: canonical-ranking agreement between the chip and the first displayed row across every theme combination, input-order independence, internal consistency of counts/confidence/shares, and null/undefined/non-object/missing-message/empty/noise-only commit handling). `server/tests/repos.repoThemes.test.js` 7 pass / 0 fail against a real local MongoDB (map present per repo, counts/shares/confidence/buckets, no commit bodies, cross-user isolation, existing-consumer compatibility, plus the new opt-in contract: the map is omitted unless `includeThemes=true`, and a malformed value returns 400). `server/tests/repos.repoThemesQuery.test.js` 9 pass / 0 fail (query scope = authenticated user + page repos only, the window is applied per repository AFTER the grouping, no global limit, `messageFull` never selected, newest-first sort with a SHA tiebreak, empty page issues no query, grouping ignores repoId-less commits). `server/tests/repos.repoThemesWindow.test.js` 9 pass / 0 fail against a real local MongoDB (the busy repository cannot consume the quiet repository's budget, a repository with 50 genuine themed commits keeps its evidence, user-scoping and page-scoping, `messageFull` never retrieved, deterministic results, zero-commit repositories, the bound enforced independently per repository, the most recent commits kept, and the health rule still seeing each repository's newest commit). `server/tests/dbTestHygiene.test.js` 5 pass / 0 fail (the config/db suite list is now DISCOVERED, not hard-coded, so new suites cannot silently escape the guard; every suite that opens a real connection must carry the INC-1 guard and pin an explicit isolated test database). `client/src/pages/Repositories.themes.test.jsx` 12 pass / 0 fail (chip text, panel denominator/themes/buckets/disclaimer, open+close, no chip when no themed commits, no chip when no repoThemes, singular "1 commit", sorting still works, unique heading ids AND unique accessible names when two panels are open, each disclosure names its repository, `aria-expanded`/`aria-controls` point at the real panel). `client/src/pages/axe.test.jsx` 8 pass / 0 fail (the fixture now includes two repositories with theme panels, plus a new case that opens TWO drill-downs and asserts no axe violation). **Full server suite 1146 pass / 0 fail / 1 skip** (the one skip requires an *unavailable* MongoDB by design). **Client suite 177 pass / 0 fail (18 files)**. **Lint PASS** (`npm run lint` exit 0: ESLint clean + Prettier clean). **Production build PASS** (2202 modules, exit 0).

**Audit corrections (2026-10-21, remediation pass).**
1. **Global commit limit starved quiet repositories (fixed).** `getCommitsByRepoIds` sorted all of the page's commits together and applied ONE `.limit(repos × 500)`. The busiest repository consumed the entire budget, so a quiet repository received **zero** commits and its theme chip silently disappeared — no error, no empty state, just a missing feature. The ingestion cap is per *fetch*, not a lifetime total, so a repository can hold far more than 500 commits and the condition is reachable in production. The read is now a single aggregation that groups by repository and applies the 500-commit window **after** the grouping, so every repository on the page keeps its own most recent commits. The same fetched set is reused by the health computation, so the endpoint still issues **one** commit query. Regression test: `repos.repoThemesWindow.test.js` (red-green verified: 4 cases fail against the old implementation).
2. **The theme chip could contradict the drill-down (fixed).** `pickTopTheme` broke a count tie by `THEME_PRIORITY` while the displayed list broke the same tie alphabetically. One `feat:` commit and one `test:` commit therefore produced a chip reading "Testing" above a panel whose first row read "Feature". Both now use one canonical comparator (`compareThemeItems`: confidence → commit count → theme priority → name), so the chip is by construction the first displayed row. Regression test: `themes.test.js` "topTheme IS the first displayed item" (red-green verified).
3. **Null commit could crash a repository aggregation (fixed).** `computeRepoThemes` filtered on `c.repoId` without a null guard, so a single `null` record threw and aborted the whole repository's analysis. `computeThemes` and `computeRepoThemesMap` now skip malformed records (null / undefined / non-object) consistently; a malformed record is not counted as a commit and never invented into a theme. Regression test: `themes.test.js` "malformed commit records are handled safely".
4. **Duplicate accessible names, not just duplicate heading ids (fixed).** The heading **id** was already unique per repository, but the landmark's accessible **name** was the constant "Commit themes for this repository", so two open panels were two landmarks with the same name — an axe `landmark-unique` violation, confirmed by running axe against the live DOM. The panel heading and the disclosure button now both name the repository ("Commit themes for synthetic/busy-service", "synthetic/busy-service: Hide themes"). Regression test: `axe.test.jsx` "Repositories with TWO open theme drill-downs has no axe violations" (red-green verified: reproduces the exact `landmark-unique` violation).
5. **React key collision (fixed).** The sample-commit list used the message text as its key; two commits with the same headline collided. The key is now `theme + index` (the server sorts the samples, so the list never reorders).
6. **The theme map was sent to a page that discards it (fixed).** `Timeline.jsx` fetches `GET /api/repos` for its repository filter but uses only `items` — it was paying for 85% of the response it threw away. The map is now opt-in via `includeThemes=true`; the Repositories page asks for it, the Timeline page does not. Measured on the local stack: the Timeline request fell from 11,977 to 1,842 bytes.
7. **The DB-backed suites silently skipped (fixed).** `getEnv()` falls back to `mongodb://127.0.0.1:27017/frieday`, which the pre-flight guard REJECTS. With no ambient `MONGO_URI`, every DB-backed suite therefore skipped its tests and reported green while exercising nothing. The suites now pin an explicit isolated database (`frieday_test_*`) through a shared `useTestDatabase()` helper, and `dbTestHygiene.test.js` enforces that for every suite that opens a real connection.
8. **The `repoThemes` map is opt-in, and the file count changed.** The map is returned only when `includeThemes=true` is requested; `includeThemes=maybe` is a 400. After the owner-review pass the release allowlist contains **37 files** (25 modified + 7 new + 1 untracked `docs/` report that must ship because the tracked `docs/RUNBOOK.md` cites it) — see the staging allowlist in the final report.
9. **Lint status corrected.** The earlier "lint PASS" claim was **false**: `npm run lint` exited 1 because 21 files failed the Prettier check. The root cause was **not** code formatting — every one of those files is byte-identical to its Prettier-formatted form once line endings are normalised. The working tree has CRLF line endings because the system Git config sets `core.autocrlf=true`, while Prettier's default is `endOfLine: "lf"`. The fix is `"endOfLine": "auto"` in `.prettierrc` (supported by the installed Prettier 3.9.9), which makes the check tolerant of the checkout's line endings without touching any source file's content and without a `.gitattributes` change.
10. **`config.yaml` is excluded from the release.** It is an unrelated local LiteLLM model-list config: untracked, read by no source file, and not part of the application. It is listed in `.prettierignore` with that reason and is explicitly excluded from the staging allowlist.

**Pre-existing issues outside Phase 10.2 (assessed, not fixed here).**
- `GET /api/repos/:id` returned `messageFull` in `recentActivity.commits` — `getRecentActivity` had no `.select()`. **Fixed 2026-10-21** (owner-review pass): the commit query now projects exactly `_id sha messageHeadline authoredAt`, so the commit body cannot reach the response. The endpoint's contract does not require it (`architecture.md` §5 describes "repo detail + recent items + mini timeline") and `prd.md` §18 states that commit bodies are never exposed. The client rendered `messageHeadline ?? messageFull`; it now renders the headline, with an honest `(no commit message)` placeholder for a commit that has none. Regression test: `repos.repoThemesWindow.test.js` "the repository detail endpoint never returns a commit body" (red-green verified) and `client/src/pages/RepoDetail.test.jsx` "renders an honest placeholder for a commit with no headline". Note: the exposure was user-scoped (the caller's OWN commits) and not a cross-user leak, so this is a privacy-minimisation correction rather than a security incident.
- The `danger` Badge tone (`text-danger` on `bg-dangerBg`) measured **4.23:1** contrast, below the WCAG AA 4.5:1 threshold for normal text. **Fixed 2026-10-21** (owner-review pass): `--danger` was darkened from `#dc2626` to `#c81e1e`, which brings the token to **5.02:1** on `danger-bg` and improves every other context that uses it (text on `--surface-2` 4.34:1 → 5.16:1; white on the solid danger fill 4.83:1 → 5.74:1). This is the same correction already applied to `--success` and `--warning`, and it restores the guarantee the stylesheet itself declares ("All text/background pairs meet WCAG AA ≥4.5:1"). The value is locked by a new test, `client/src/styles/tokens.test.jsx` (17 cases), which reads the ACTUAL token values from the stylesheet and asserts the ratio for every declared text/background pair.

**End-to-end verification (2026-10-20; re-verified 2026-10-21).** Completed against a **genuinely isolated** local stack: backend on port 5001 with `MONGO_URI` pre-set to an isolated local database `frieday_p102_e2e` (the root `.env` points at production Atlas — `dotenv` does not override pre-set variables, so the local server never touched production), frontend on port 5174 proxied to it. Synthetic user/repos/commits only. The real Express route returned `repoThemes` for all three repositories; reconciliation held per repository (19 = 16+1+1+1, 1 = 1+0+0+0, 0 = 0); shares summed to 1.0000 over the themed denominator; evidence was bounded (5 samples, not 12); no `messageFull` body, no other-user commit/repo, no token material in the response. The real React UI rendered "Bug fix · 12 commits" and "Documentation · 1 commit" chips, produced no chip for the zero-commit repository, opened the drill-down with the correct denominator, buckets, disclaimer and a unique heading id, and issued **no per-repository request** (2 endpoints only). Measured at 320/390/768/1024/1440px: no horizontal scroll at any width, chip inside its row, panel inside the viewport, sidebar 248→64→hidden. **Screenshots could not be captured** (DevTools capture timed out repeatedly in this environment) — DOM measurements were used as the evidence instead. **Not deployed**: production still runs `faac061`, which has no theme chips (0 chips, 0 drill-down buttons observed on the live page).

**Browser verification (2026-10-21, Chrome DevTools MCP — the extension was connected and controlled a live Chrome session).**

*Production baseline (read-only).* Opened `https://frieday.onrender.com/repositories`. The live `GET /api/repos?sort=activity&limit=50` response body has the top-level keys `items`, `nextCursor`, `hasMore` — **no `repoThemes`** — and the page shows **0** theme chips and **0** drill-down buttons. Phase 10.2 is therefore **not deployed**; production still serves the `faac061` baseline. Responsive measurements at 320/390/768/1440 CSS px: `documentElement.scrollWidth === clientWidth` at every width (no horizontal overflow). The production session expired mid-run and the app redirected to `/login`; re-authenticating would have meant mutating production, so the authenticated production inspection stopped there and the remaining widths were not re-measured against the authenticated page.

*Local Phase 10.2 UI (isolated).* A local stack on `127.0.0.1` only — API on 5199, the built client on 5198, an isolated `frieday_test_p102_verify` database with 1,490 synthetic commits across 4 repositories (a 1,200-commit busy repo, a 50-commit quiet repo with older commits, a 240-commit repo, and a 0-commit repo). The session cookie was minted in-process and injected by a local proxy, so no token was ever printed.
- The live `GET /api/repos?...&includeThemes=true` returned all four repositories: the quiet repository kept **all 50** of its commits (`total=50 themed=50 top=Documentation x50`) — the starvation fix confirmed end-to-end — while the busy repository was capped at 500 (`total=500 themed=400 top=Bug fix x200`) and the empty repository got `total=0` and **no chip**.
- The UI rendered 3 chips, opened 3 drill-downs simultaneously, and the DOM showed **unique heading ids, unique accessible names** ("Commit themes for synthetic/busy-service", etc.), **no duplicate ids**, `aria-expanded` reflecting state, and `aria-controls` pointing at an existing panel for every toggle. The chip theme and the panel's first row **agreed on all three repositories**.
- Axe 4.13.0 run against the live DOM with two panels open: **0 `landmark-unique` violations**. The only violation reported was `color-contrast` on the `danger` Badge tone — a pre-existing token issue (see above), not a Phase 10.2 element.
- **No console errors or warnings** (no React key warnings) and only **2 endpoint types** were requested — no per-repository request.
- Responsive measurements at 320/390/768/1024/1440 CSS px with panels open: `scrollWidth === clientWidth` at every width; chips and panels stayed inside the viewport; the sidebar measured 0 (hidden) at 320/390, 64 (collapsed) at 768 and 248 (expanded) at 1024/1440.
- Sorting to `recent` replaced the page cleanly: the panels closed, the chips were re-fetched and no stale theme data remained.
- Payload: the Timeline page's request (no `includeThemes`) measured **1,842 bytes** against **11,977 bytes** with the map — an 85% reduction for the page that discards it. Local API latency: 25–50 ms.
- Screenshots were captured (`frieday-local-p102-1440.png`, `frieday-prod-login-768.png`).

**Not deployed.** Phase 10.2 is implemented, tested, lint-clean, build-verified and browser-verified **locally only**. No commit, push, PR, merge or deployment has been performed; the branch remains uncommitted and unstaged pending owner review.

**Owner-review verification pass (2026-10-21).** An independent pass re-verified every claim above against the current tree and closed three remaining items.

1. **`server/tests/dbTestTarget.test.js` resolved — it is REQUIRED, not ambiguous.** Git history shows it was never committed (`git log --all` is empty for it) and that it was created on 2026-10-20 23:25, alongside `server/tests/helpers/dbTestTarget.js` (2026-10-21 10:06) — both are new Phase 10.2 safety work. At `faac061` the "INC-1 guard" was a **post-connection** check (the suites called `db.connectDb()` first and only then inspected `mongoose.connection.host` / `.name`); the new helper validates the RESOLVED URI **before** `mongoose.connect()` is ever called, so a production-targeting `MONGO_URI` can no longer open a socket to production. The test file is the required regression suite for that guard and **must ship with it**. Evidence of the pre-connection rejection: a production-style target (`mongodb+srv://…@cluster0.example.invalid/frieday_prod`, a reserved example domain) throws `UNSAFE_DB_TARGET` with **0 `mongoose.connect` calls**, and the error text contains no URI, host, username or password.
2. **`/api/repos/:id` no longer exposes `messageFull`** (see the pre-existing-issues section above). Narrow projection fix + a red-green-verified regression test on both the server and the client.
3. **The `danger` contrast failure is fixed** (see above), and axe 4.13.0 now reports **0 violations** of any kind against the local page with three drill-down panels open — the previous `color-contrast` finding is gone.

Re-verified in this pass, with the current tree:
- **Gates** — targeted backend 138 pass / 0 fail / 0 skip; full server **1146 pass / 0 fail / 1 skip**; client **177 pass / 0 fail (18 files)**; `npm run lint` exit 0; `npx eslint .` exit 0; `git diff --check` exit 0; isolated `vite build` exit 0 (2202 modules, `client/dist` untouched — byte-identical and unchanged timestamps); isolated `docker build` exit 0 (23.6s, image removed afterwards).
- **Production baseline, re-checked independently** — the deployed bundle is `index-B7lb8q2Z.js` and contains **no** `repoThemes`, **no** "View themes" and **no** `includeThemes`. Production still serves the pre-Phase-10.2 build. The authenticated production session had expired, so the production measurements were taken against the unauthenticated shell: no horizontal overflow at 320/390/768/1024/1440 CSS px.
- **Local UI** — 3 chips, 3 panels open simultaneously, unique heading ids **and** unique accessible names, **0 duplicate ids**, `aria-expanded`/`aria-controls` correct on every theme toggle, chip == panel's first row on all 3 repositories, denominator shown, the zero-commit repository given no chip, sorting leaving no stale theme data, **0 axe violations**, **no console errors or warnings**, and only **2 endpoint types** requested. **Keyboard**: the toggle is a native `<button>`; `Enter` opens the panel (`aria-expanded` → `"true"`, label → "Hide themes", panel and heading appear, focus stays on the control) and `Space` closes it. Responsive: no horizontal overflow at 320/390/768/1024/1440 px with panels open; sidebar 0 → 0 → 64 → 248 → 248 px.
- **Payload** — the Timeline page's request (no `includeThemes`) measured **1,842 bytes** against **11,977 bytes** with the map (−85%); the live network log confirms Timeline requests `/api/repos?sort=activity&limit=50` **without** `includeThemes` while the Repositories page requests it **with**. Latency measured directly (not inferred): **17.4–25.3 ms** without themes, **24.2–62.3 ms** with. The app has **no compression middleware** (no `Content-Encoding` header); production's `content-encoding: br` comes from the Cloudflare edge, not the application.



