# Frieday — Engineering Rules (Constitution)

> Enforceable rules for all human and agent contributors. Violations block merge.
> Companion docs: `prd.md`, `architecture.md`, `design_system.md`, `agents.md`, `tasks.md`.
> Last updated: 2026-10-02

**Rule severity:** `MUST` = blocking. `SHOULD` = strong default, justify exceptions in PR description. `NEVER` = blocking, no exceptions without owner approval + doc update.

---

## 1. Code Quality

- MUST: ESLint + Prettier pass (`npm run lint`). No `eslint-disable` without a comment explaining why + linked issue.
- MUST: no dead code, no commented-out blocks, no `TODO` without an issue ID (`TODO-#123` or `TODO-V1` for explicitly deferred V1 work — bare `TODO` is rejected).
- SHOULD: functions ≤50 lines, files ≤300 lines. Split when exceeded unless justified.
- MUST: no `any` (frontend) / unvalidated `Mixed` writes (backend) without a zod schema or explicit review note.
- NEVER: commit `console.log` debug output. Use `logger.js` (backend) or remove (frontend).

## 2. Naming

- Files: `kebab-case` for frontend components (`insight-card.jsx`), `dot.namespace` for backend services as per `architecture.md` §4 (e.g., `repos.fetcher.js`, `timeline.js`). MUST match the directory structure doc — don't invent new conventions.
- Variables/functions: `camelCase`, booleans prefixed (`isActive`, `hasEvidence`, `canResync`).
- Components: `PascalCase`. Hooks: `useX`. Mongoose models: singular `PascalCase` (`PullRequest`).
- Constants/env: `SCREAMING_SNAKE`. API error codes: `SCREAMING_SNAKE` (`RATE_LIMITED`).
- MUST: name metrics with range + scope (`commitsLast90d`, not `commits`). Ambiguous counts are rejected in review.

## 3. Folder Structure

- MUST: respect `architecture.md` §4 as authoritative. New code goes in its layer:
  - GitHub network code → `server/src/services/github/` ONLY.
  - Metric math → `server/src/services/intelligence/` ONLY (pure functions).
  - LLM calls → `server/src/services/ai/` ONLY.
  - DB schemas → `server/src/models/` ONLY.
  - Reusable UI primitives → `client/src/components/ui/`; page-specific → `components/domain/` or the page file.
- NEVER: create a parallel top-level folder (`/lib2`, `/helpers-new`, `/services2`) instead of using the existing one. Extend, don't duplicate.
- MUST: frontend pages map 1:1 to routes (`pages/Dashboard.jsx` ↔ `/dashboard`). No orphan pages.

## 4. Component Structure (Frontend)

- MUST: every data component handles three states: loading (Skeleton), empty (EmptyState), error (ErrorCard with retry). A component with only the happy path is incomplete.
- MUST: components receive data via props/hooks, never fetch GitHub directly, never import server code.
- SHOULD: colocate small subcomponents; extract to `components/` when reused twice.
- MUST: charts wrap Recharts primitives in `components/charts/*` (consistent tooltips, colors from design tokens). No inline chart config duplication.
- MUST: user-facing numbers always show scope caption ("authored by you · last 90d · synced repos") via shared `<MetricCaption>` or tooltip.

## 5. API Design

- MUST: routes defined in `server/src/routes/`, thin controllers, logic in services. No business logic in route files.
- MUST: every input validated with zod via `validate.js`. Unvalidated `req.query/body/params` access is rejected.
- MUST: error envelope `{ error: { code, message, details?, retryable } }`. No raw stack traces, no `err.message` passthrough for unknown errors.
- MUST: cursor pagination for lists (`limit` default 20, max 50). No unbounded arrays.
- MUST: `range` params allowlist (`30d|90d|12m`). Unknown values → `VALIDATION_ERROR`, never silent default without logging.
- SHOULD: GETs are cache-safe and have no side effects (except `explain`, which is POST).

## 6. Database Access

- MUST: all queries via Mongoose models. No raw driver calls unless reviewed.
- MUST: every user-scoped query includes `userId`. Service functions take `userId` as first arg. Tests MUST include a cross-user access test for new endpoints.
- MUST: upserts keyed on GitHub IDs (see `architecture.md` §6 indexes). No duplicate-creating `create()` in sync paths — use `bulkWrite` with `upsert`.
- MUST: never overwrite newer data with older (compare `authoredAt`/`githubUpdatedAt` before write in webhook/V1 paths).
- SHOULD: use `.lean()` for read-only queries. Use transactions only when multi-doc atomicity is required (document why).

## 7. Authentication

- MUST: protect user-data routes with `requireAuth`. No `// TODO: add auth later`.
- MUST: sessions via httpOnly `fd_access`/`fd_refresh` cookies. NEVER store GitHub tokens or JWTs in `localStorage`, `sessionStorage`, or client-readable cookies.
- MUST: verify OAuth `state` on callback. Missing/invalid → 403, no token exchange.
- MUST: token decrypt happens server-side per request, held in memory only, never attached to responses or logs.

## 8. Authorization

- MUST: `req.user.id === resource.userId` enforced in service layer, not just route layer. Defense in depth.
- NEVER: admin/escalation endpoints in MVP. No `isAdmin` flags, no cross-user reads.
- MUST: repo detail endpoint 404s (not 403s with existence leak) for repos belonging to other users — return identical response for "not found" and "not yours".

## 9. Security

- MUST: `helmet`, restrictive CORS (`CLIENT_URL` only + `credentials`), CSP, HSTS in prod (see `architecture.md` §13).
- MUST: all secrets from env only. `git grep -i "sk-\|ghp_\|BEGIN PRIVATE"` MUST be clean in CI. No secrets in tests (use fakes).
- MUST: validate webhook HMAC (V1) before parsing body for processing; reject 401 on mismatch.
- MUST: truncate stored free text (commit messages ≤500ch, titles ≤200ch, file lists ≤50) — prevents storage bombs + prompt-injection payload bloat.
- MUST: `npm audit` — zero High/Critical before merge. Document exceptions with expiry.
- NEVER: log tokens, secrets, cookies, full diffs, or PII beyond GitHub login. Log IDs, not contents.

## 10. Environment Variables & Secrets

- MUST: every new env var added to `.env.example` (with comment + safe placeholder) and `config/env.js` (zod-validated) in the same PR. Code reading `process.env` directly outside `config/env.js` is rejected.
- MUST: fail fast at boot on missing/invalid required vars with a named error (`Missing env: TOKEN_ENC_KEY`), not a cryptic crash later.
- NEVER: commit `.env`. NEVER paste real tokens in docs, issues, or code comments.

## 11. GitHub API Usage & Rate Limits

- MUST: all GitHub calls go through `services/github/*` (Octokit factory + fetchers + `rateLimit.js`). No ad-hoc `fetch(api.github.com)` elsewhere.
- MUST: paginate (`per_page=100`), use `since`/ETag cursors from `SyncState`, honor `Retry-After` and `x-ratelimit-*` headers.
- MUST: concurrency cap (default 2 per sync, env-overridable). No `Promise.all` over unbounded repo lists.
- MUST: respect sync caps (`SYNC_MAX_REPOS`, `SYNC_MAX_COMMITS_PER_REPO`, etc.). Raising caps requires a doc note + justification.
- MUST: record `fetchedAt` + `source` (`rest|webhook`) on synced docs. Data without provenance is rejected.

## 12. Error Handling

- MUST: backend uses `errorHandler.js` envelope. Throw typed errors (`NotFound`, `RateLimited`, `ValidationError`); don't invent ad-hoc shapes.
- MUST: sync failures are partial, not total — persist per-resource error, keep prior good data, surface per-repo warnings. A single repo failure MUST NOT wipe the dashboard.
- MUST: frontend distinguishes retryable (`RATE_LIMITED`, `GITHUB_UNREACHABLE`, network) with Retry buttons vs. fatal (401 → login redirect).
- NEVER: swallow errors silently (`catch {}` empty). Log with `reqId`/`jobId` + code, show user-safe message.

## 13. Logging

- MUST: backend uses `pino` (`utils/logger.js`). No `console.log` in server code.
- MUST: include `reqId` (requests) / `jobId` + `userId` (jobs) on every log line in those flows.
- MUST: `info` for lifecycle (sync start/phase/done), `warn` for backoff/AI-fallback/validation rejects, `error` for failures. `debug` for payloads (never in prod with PII).
- NEVER: log tokens, secrets, cookies, Authorization headers, full commit diffs, or LLM API keys.

## 14. Validation

- MUST: zod schemas for all API inputs, all `AIExplainer` inputs/outputs, and `config/env.js`.
- MUST: validate webhook payload shapes (V1) before processing.
- MUST: AI output validated by `ai/validate.js` allowlist (numbers, repo names, dates must appear in input). Unvalidated LLM text NEVER reaches the client.

## 15. Testing

- MUST: new intelligence functions ship with unit tests + fixtures (input records → expected buckets/insights). No untested math.
- MUST: new endpoints ship with integration tests: happy path + 401 (no auth) + cross-user (404) + validation error. Auth bypass is a P0.
- MUST: sync orchestrator tests use faked fetchers (no live GitHub in CI). Record/replay fixtures only.
- SHOULD: maintain coverage for `intelligence/` at ≥80%. Don't chase global coverage theater; cover truth-producing code.
- MUST: `npm run lint`, `npm test`, `npm run build` pass on clean checkout before merge. Broken main is a revert-first incident.

## 16. Dependency Management

- MUST: justify every new dependency in the PR (what, why not stdlib/existing, size, maintenance). `npm` audit + bundle impact noted for frontend deps.
- MUST: pin major versions; lockfile committed. No `*` ranges.
- NEVER: add an LLM SDK as a required runtime dependency in MVP. AI stays behind `AI_ENABLED=false` + optional import until V1 approval.
- SHOULD: prefer stdlib + existing stack (date-fns already chosen — don't add moment/dayjs).

## 17. Frontend State Management

- MUST: exactly one approach: React context + hooks for auth/sync state; server state via `apiClient` + hooks (`useDashboard`, etc.) with cache-then-refetch. No Redux + Zustand + context soup.
- MUST: all API calls go through `lib/apiClient.js` (`credentials: include`, base URL from `VITE_API_URL`, typed errors). No inline `fetch()` to API routes.
- MUST: range selection (30d/90d/12m) and repo filter live in URL search params (shareable, back-button safe).

## 18. API Communication

- MUST: JSON only, `/api` prefix, cookies for auth. No tokens in URLs or headers from client.
- MUST: handle 401 globally (redirect to login), 429/503 with backoff + user message, unknown errors with generic card + Retry.
- SHOULD: poll `GET /api/sync/status` at 2s during sync only; stop on done/error. No perpetual polling.

## 19. Loading / Empty States

- MUST: skeletons mirror final layout (card-shaped shimmer, chart placeholder with axes). No layout shift on load.
- MUST: empty states state cause + next action ("No activity in this range — try 90d or Resync"). Never shame ("You were lazy").
- MUST: sync progress shows phase + counts + cancellable-safe messaging ("You can leave — sync continues"). No fake progress bars.

## 20. Accessibility

- MUST: semantic landmarks, focus-visible styles, keyboard-reachable controls/charts (tab + arrow where applicable), `aria-live` for sync progress and toasts, contrast ≥4.5:1 for text (tokens in `design_system.md` guarantee this).
- MUST: charts have text equivalents (data table toggle or summary list). Color is never the only encoding (labels/patterns accompany hues).
- MUST: `axe`-clean on Dashboard, Repos, Settings before MVP sign-off (see `prd.md` §23).

## 21. Performance

- MUST: dashboard reads come from Mongo/buckets, never live GitHub fan-out. No N+1 fetches (batch per-repo queries, cap concurrency).
- MUST: paginate repo items and table rows (≤50/page). No rendering 5,000 commits at once (virtualize or paginate).
- SHOULD: memoize aggregate endpoints server-side (60s TTL per `architecture.md` §14); code-split frontend routes (`React.lazy`).
- MUST: images (avatars) lazy-load with fixed dimensions (no CLS).

## 22. Git Commits

- MUST: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). One logical change per commit.
- MUST: messages state what + why, not just what (`fix(sync): back off on 429 to respect secondary limits`).
- NEVER: commit secrets, `.env`, `node_modules`, build output, or AI-generated bulk files without review.
- SHOULD: reference task IDs from `tasks.md` (`feat(sync): initial orchestrator [T2.3]`).

## 23. Documentation

- MUST: update the six source-of-truth docs when behavior changes (same PR if scope changes; docs-first for architecture changes per `agents.md`).
- MUST: JSDoc on exported service functions (params, returns, throws). Intelligence functions document definitions (e.g., active-day rule + version).
- MUST: README "Getting started" stays runnable (clone → `cp .env.example .env` → fill → `npm run dev` works).

---

## 24. STRICT AI RULES (blocking — violations are P0 defects)

These implement `prd.md` §§18–19 and `architecture.md` §§10–11. They apply to all code, prompts, and UI copy.

1. **NEVER fabricate data.** No metric, repo name, date, language, streak, or achievement without a backing DB record. No placeholders presented as real.
2. **NEVER infer unsupported behavior.** Forbidden: "expert", "mastery", "10x", "top 1%", hiring recommendations, personality judgments. Allowed only: observed, scoped, confidence-labeled summaries.
3. **NEVER claim a skill without evidence.** "Skill" language is banned in MVP. V1+ may say "recent focus" with confidence + evidence, never "skill level".
4. **NEVER calculate important metrics inside an LLM.** Counts, deltas, streaks, shares, health labels are computed in `services/intelligence/` (tested). The LLM receives finished numbers and paraphrases them.
5. **Deterministic calculations MUST happen in application code.** If a number appears in UI, a unit-tested function produced it. Trace every displayed number to code in review.
6. **AI is responsible for explanation/summarization, NOT truth generation.** System prompts MUST contain the no-invention instruction (see `architecture.md` §11). Prompts without it are rejected.
7. **Every AI insight MUST be traceable to underlying evidence.** UI pairs AI text with "View evidence" (metrics + repo/date refs) 100% of the time. Orphan AI text is a defect.
8. **AI output MUST be validated.** `ai/validate.js` allowlist check before serving. Failures → template fallback + logged incident. Bypassing validation is rejected.
9. **AI MUST degrade gracefully.** `AI_ENABLED=false` or provider outage changes wording only, never availability. No feature may require AI to function.
10. **AI MUST be labeled.** AI-produced text carries "AI summary (beta)" + opt-out in Settings. Presenting AI text as system-computed fact is rejected.
11. **Prompt-injection hygiene.** NEVER feed raw untrusted text (commit messages, issue titles) into prompts beyond aggregated counts in MVP. V1 expansions require explicit user action + sanitization + length caps.
12. **Review gate.** Any PR touching `services/ai/`, prompts, or insight copy MUST be reviewed against this section checklist and note compliance in the PR description.

---

## 25. Agent / Coding-Assistant Rules

1. **Inspect before modifying.** Read the target file(s) + relevant docs (`prd.md`, `architecture.md`, this file) before editing. No blind rewrites.
2. **Do not rewrite working systems unnecessarily.** Smallest diff that satisfies the task. No drive-by refactors.
3. **Do not create duplicate modules.** Search (`glob`/`grep`) for existing helpers before adding new ones.
4. **Do not introduce dependencies without justification** (see §16). Unapproved deps are reverted.
5. **Do not silently change architecture.** Layer moves, new top-level dirs, new endpoints, schema changes → flag conflict per `agents.md`, propose doc update, wait for approval.
6. **Do not mark incomplete functionality as complete.** `[~]` stays until acceptance criteria + tests pass. Fake "done" is a trust violation.
7. **Always run relevant checks after implementation:** `npm run lint` + `npm test` (affected scope minimum) + `npm run build` for frontend changes. Report actual output, not "should pass".
8. **Treat the six docs as authoritative.** On conflict between request and docs, follow `agents.md` conflict protocol (identify → explain → propose → wait), never silent override.

---

## Appendix — Review Checklist (copy into PRs touching truth-producing code)

- [ ] Numbers trace to tested intelligence functions (link tests)
- [ ] UI shows range + scope + confidence where required
- [ ] No new GitHub calls outside `services/github/`
- [ ] No LLM calls outside `services/ai/`; output validated
- [ ] Auth + cross-user tests present for new endpoints
- [ ] Loading/empty/error states implemented
- [ ] `.env.example` + `config/env.js` updated if config changed
- [ ] `npm run lint && npm test && npm run build` output pasted
