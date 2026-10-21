# Frieday — Product Requirements Document (PRD)

> Single Source of Truth for product scope. Companion docs: `architecture.md`, `rules.md`, `design_system.md`, `agents.md`, `tasks.md`.
> Status: **Draft v1.0 — Planning only, no implementation**
> Last updated: 2026-10-02

---

## 1. Product Overview

**Frieday — Developer Intelligence Platform.**

Frieday connects to a developer's GitHub account and transforms raw development activity into meaningful, evidence-based developer intelligence.

Frieday is **not** a GitHub stats clone. It does not stop at counts ("420 commits"). It builds an **intelligence layer** on top of verified GitHub data:

> "Your backend development activity increased significantly over the last six weeks, with most recent work concentrated around API and database-related repositories."

Every insight must be grounded in actual collected data. Frieday **never invents** behavior, achievements, skills, or statistics.

**Tagline:** "Frieday understands how you build software."

---

## 2. Product Vision

Long-term: Frieday becomes the trusted system of record for *how a developer works* — across repositories, languages, time, and projects — useful for self-reflection, growth, portfolio proof, and team understanding.

Short-term (MVP → V1): one user connects one GitHub account, Frieday ingests and normalizes that user's accessible activity, computes deterministic intelligence, and presents it in a clear, premium dashboard with evidence trails. AI is used only to *explain* pre-computed evidence, never to generate truth.

Vision principles:

1. **Evidence first.** No metric without a data source. No skill without evidence.
2. **Understanding over vanity.** Trends, consistency, focus areas > raw totals.
3. **Honest about uncertainty.** Small samples, gaps, and private repos are disclosed, not hidden.
4. **Developer-respecting.** No surveillance framing, no pseudo-grading, no hiring scores.

---

## 3. Problem Statement

Developers produce large volumes of work across many repositories, but:

- GitHub's native UI is repository-centric, not developer-centric. There is no unified "how do I work" view.
- Existing "stats" tools show vanity numbers (stars, streaks, commit counts) without context, trends, or explanations.
- Developers cannot easily answer: "What have I actually focused on lately?", "Am I consistent?", "Which projects are healthy vs. stalled?", "What is my verifiable track record?"
- Any AI-generated summary of a developer that is not grounded in data is untrustworthy and potentially harmful.

Frieday solves this by ingesting GitHub activity, normalizing it into a developer-centric model, computing deterministic analytics, and explaining them in plain language with drill-down evidence.

---

## 4. Target Users

**Primary (MVP):** Individual developers with active GitHub accounts who want personal insight into their work habits, focus, and growth.

**Secondary (V1+):**

- Developers building a verifiable portfolio / career narrative.
- Indie hackers / maintainers tracking project health across repos.
- (Future only, explicitly not MVP): team leads wanting aggregate, opt-in team views.

**Non-users (explicitly not targeted):** recruiters seeking automated candidate ranking, employers seeking employee surveillance.

---

## 5. User Personas

### Persona 1 — Aarav, Full-Stack Builder (primary)

- 2–5 years experience, works across 10–30 repos (personal + org + freelance).
- Pain: "I did a lot last quarter but can't articulate what or show it."
- Wants: monthly/quarterly narrative of focus areas, language mix, consistency, busiest repos.
- Success: can open Frieday and in 60 seconds understand "what did I work on and how consistently."

### Persona 2 — Maya, Backend Maintainer (primary)

- Maintains 2–3 important API/database services, fewer but deeper commits. Reviews many PRs.
- Pain: commit counts undervalue review and maintenance work.
- Wants: PR/issue activity recognized alongside commits; project health view.
- Success: sees review + issue + commit activity unified in one timeline.

### Persona 3 — Dev, Career Switcher / Student (secondary)

- Sparse history, bursty activity around courses/bootcamps.
- Pain: "My profile looks empty even though I learned a lot."
- Wants: honest, encouraging view that doesn't shame gaps; shows growth trend even from small base.
- Success: sees trend ("activity up 3 of last 4 weeks") with correct caveats about small sample size.

### Anti-persona — Surveillance Manager

- Wants to rank or monitor developers automatically. **Frieday will not serve this.** No stacked ranking, no productivity scores for judging others, no hidden scoring.

---

## 6. Core User Journeys

### Journey A — Connect & First Insight (critical path)

1. User lands on Frieday marketing/login page → clicks "Connect with GitHub".
2. GitHub OAuth consent → redirect back to Frieday.
3. Frieday shows "Syncing your repositories…" with progress (repos → commits → PRs → issues → languages).
4. First dashboard loads: overview cards (active repos, commits 90d, PRs 90d, active days), activity timeline chart, language breakdown, top repos, and 2–3 template-generated insights with evidence links.
5. User clicks an insight → sees underlying evidence (e.g., weekly commit counts, repo list, date range).
6. User triggers "Resync" manually when they want fresh data.

Acceptance: user goes from login to understandable dashboard in < 3 minutes for a typical account (< 50 repos), with clear progress and no dead ends.

### Journey B — Understand a Trend

1. User opens Timeline / Trends view.
2. Sees 12-week activity chart by week, split by commits vs. PRs.
3. Reads insight: "Backend activity increased over last 6 weeks, concentrated in `api-gateway` and `db-migrations`."
4. Clicks through to repo detail showing that repo's recent commits/PRs.
5. Feels confident because numbers match what they remember doing.

### Journey C — Review Project Health

1. User opens Repositories view.
2. Sees per-repo: last activity, commit velocity (30d/90d), open issues/PRs, dominant languages.
3. Identifies a stalled repo ("no commits in 60 days, 8 open issues") vs. healthy repo.
4. No judgment language — factual status + evidence.

### Journey D — Disconnect / Data Control

1. User opens Settings → "Disconnect GitHub / Delete my data".
2. Confirms → tokens revoked, synced data deleted (per retention policy), session ended.
3. Sees confirmation. Can reconnect later from scratch.

---

## 7. Product Principles

1. **Evidence over assertion.** Every insight links to the data that produced it.
2. **Deterministic before generative.** Compute in code; use AI only to phrase, never to invent.
3. **No vanity without context.** Always pair totals with time range, scope, and caveats.
4. **Respect gaps.** Inactivity, private repos, and force-pushes are disclosed as limitations, not moralized.
5. **Boring reliability.** Sync must be predictable, resumable, and rate-limit aware. No silent failures.
6. **Privacy by default.** Only the user's own accessible data; no cross-user comparison in MVP/V1.
7. **Restraint.** Fewer, trustworthy insights > many speculative ones.

---

## 8. Core Features

| # | Feature | What it does |
|---|---------|--------------|
| F1 | GitHub OAuth connection | Secure login + repo-scope connection, disconnect/revoke |
| F2 | Data synchronization | Ingest repos, commits, PRs, issues, languages for authenticated user |
| F3 | Developer overview dashboard | Cards + charts: activity, languages, top repos, consistency at a glance |
| F4 | Activity timeline | Daily/weekly commit + PR + issue-event timeline with filters |
| F5 | Repository views | Repo list + repo detail with health signals and recent activity |
| F6 | Language & focus breakdown | Language share by bytes/commits, inferred focus areas (API, frontend, DB) via deterministic heuristics with confidence labels |
| F7 | Consistency & trends | Active days, streaks (with honest definition), week-over-week deltas |
| F8 | Insights feed | 3–8 human-readable insights generated from deterministic rules, each with evidence payload and drill-down |
| F9 | AI explanation layer (V1, not MVP) | LLM paraphrase/summary of a pre-computed insight + evidence; never computes metrics |
| F10 | Manual resync + sync status | Progress, last-synced timestamps, per-resource status, error display |
| F11 | Webhooks auto-sync (V1) | GitHub webhooks keep data fresh without manual sync |
| F12 | Settings & data control | Profile, token status, disconnect, delete data |

---

## 9. Feature Descriptions

### F1 — GitHub OAuth Connection

- Uses GitHub OAuth App flow with `state` for CSRF.
- Minimal scopes for MVP: `read:user`, `repo` (to include private repos user can access; see §17 for scope justification and future reduction). Public-only mode considered post-MVP.
- Backend exchanges code for token server-side; token encrypted at rest; never exposed to frontend.
- Session via httpOnly secure cookies (app JWT). Frontend never sees GitHub token.

### F2 — Data Synchronization

- MVP resources: user profile, owned + collaborated repos (up to documented cap, e.g., 100 repos for MVP), commits (authored by user, last 12 months capped per repo), PRs (authored/reviewed, open+merged), issues (authored/assigned), languages per repo.
- Incremental sync using `since` / ETag where possible; full re-sync available.
- Rate-limit aware: reads `X-RateLimit-*` headers, backs off, queues, surfaces status. Never hammers API in a tight loop.
- Sync is a background job with progress events; UI polls sync status.

### F3 — Overview Dashboard

Layout (see `design_system.md` §16): greeting + date-range selector (30d/90d/12m), KPI cards (Active repos, Commits, PRs opened/merged, Active days, Current streak), main timeline chart, language donut/bar, top repos table, insights list.

### F4 — Activity Timeline

- Daily buckets for 30d view, weekly buckets for 90d/12m views.
- Series: commits, PRs opened, PRs merged, issues touched. Filters by repo.
- Hover tooltip shows exact counts + date range. Click drills to underlying items.

### F5 — Repository Views

- List: name, visibility, primary language, stars (context only), last activity, commits (90d), open PRs/issues, health badge (Active / Steady / Quiet / Stalled — defined deterministically, see §18).
- Detail: header + stats + language bar + recent commits/PRs/issues (paginated, newest first) + mini timeline.

### F6 — Language & Focus Breakdown

- Language share from GitHub `languages` endpoint (bytes per language per repo, aggregated weighted by user's commit involvement — heuristic documented in architecture).
- Focus areas (MVP heuristic, labeled "Beta"): keyword + file-path + language mapping, e.g., `api|server|routes` + JS/TS/Go/Python → "API work"; `migrations|schema|sql` → "Database work"; `components|pages|css` → "Frontend work". Always shows confidence (High/Medium/Low) and sample evidence (repos/files). No claim of "skill mastery".

### F7 — Consistency & Trends

- Active day = day with ≥1 authored commit OR merged PR OR meaningful issue event (definition fixed in code, documented in UI tooltip).
- Streak = consecutive active days (or active weeks for 12m view); gaps shown honestly.
- Deltas: % change vs. prior equal-length period, suppressed when base < threshold (e.g., <5 events) with "Not enough data" label instead of misleading %.

### F8 — Insights Feed

MVP insight templates (deterministic, rule-based, max ~8):

1. Activity momentum (up/down/flat vs. prior period).
2. Focus shift (top focus area changed vs. prior period).
3. Busiest repository / concentration (e.g., "62% of commits in 2 repos").
4. Consistency note (e.g., "Active 18 of last 30 days").
5. Review contribution (PRs reviewed/merged vs. authored).
6. Project health flag (repo gone quiet / revived).
7. Language mix change.
8. Quiet period note (no moralizing: "No recorded activity Jul 12–19 — may include private/unconnected work").

Each insight stores: `templateId`, `timeRange`, `metrics`, `evidenceIds`, `confidence`, `generatedAt`. UI shows text + "View evidence" expander.

### F9 — AI Explanation Layer (V1, NOT MVP)

- Takes a stored deterministic insight + evidence JSON and returns a 1–3 sentence paraphrase + optional "why it matters" line.
- Input/output schema strictly validated. Model output never persisted as truth; only displayed alongside the underlying numbers and evidence link.
- If AI unavailable/disabled, template text is shown. No feature depends on AI to function.
- See §19 and `architecture.md` AI flow.

### F10 — Manual Resync + Sync Status

- "Sync now" button with disabled state while sync in progress. Progress bar with per-resource counts. Last-synced per resource. Errors shown with retry.

### F11 — Webhooks Auto-Sync (V1)

- `push`, `pull_request`, `issues` events → verify signature → enqueue incremental ingest. Falls back to scheduled sync if webhook missing.

### F12 — Settings & Data Control

- Show connected GitHub username, scopes, token status, data summary (repos/events stored), buttons: Resync, Disconnect, Delete all my data.

---

## 10. MVP Scope

**MVP = Phases 0–5 (see `tasks.md`). Usable personal intelligence without LLM and without webhooks.**

Included:

- GitHub OAuth login/logout, session, disconnect.
- Initial + manual sync for repos, commits, PRs, issues, languages (caps documented).
- MongoDB normalized storage.
- Deterministic intelligence engine (timeline aggregation, language/focus heuristics, consistency, deltas, repo health, insight templates F8).
- Dashboard: overview, timeline, repos list + detail, languages, insights (template text only), sync status, settings.
- Loading / empty / error states for every view.
- Basic observability: health endpoint, structured logs, request IDs.

Explicitly **not** in MVP: LLM/AI explanations, webhooks, auto-sync scheduler (beyond manual + initial), public sharing, team views, notifications, mobile app, advanced skill inference.

MVP success = a developer with a normal GitHub account can connect, sync, and understand their last 90 days in under 3 minutes, trusting the numbers.

---

## 11. Post-MVP Scope (V1)

V1 = MVP + :

- AI explanation layer (F9) behind provider abstraction + on/off flag + evidence-traceable UI.
- Webhooks (`push`, `pull_request`, `issues`) + signature verification + background queue.
- Scheduled incremental sync (e.g., every 6h per connected user, rate-limit aware).
- Repo detail pagination polish, date-range persistence, CSV export of timeline (simple).
- Delete-data + disconnect hardened, token refresh handling.
- Basic caching (server-side memoization / Redis if justified) for dashboard aggregates.

---

## 12. Future Possibilities (explicitly not committed)

- Multi-provider (GitLab, Bitbucket).
- Org/team aggregate views (opt-in only).
- ~~Commit-message theme clustering (deterministic topic extraction before any LLM).~~ **PROMOTED to Phase 10.1 (committed)** — see §12.1.
- Contribution to open-source vs. personal work split.
- Goal tracking ("ship 3 PRs/week") — only if non-shaming design validated.
- Portfolio / shareable profile page with verified badges.
- IDE extension surfacing personal focus hints.
- Anomaly detection (unusual burst/drop with honest uncertainty).

None of these are in MVP or V1 scope. They must not appear in `tasks.md` as committed work.

### 12.1 Phase 10.1 — Commit-theme clustering (promoted from Future)

**Promoted (2026-10-20) to committed scope.** Commit-message theme clustering is
now Phase 10.1 work, tracked in `tasks.md` as T10.1. It is a *deterministic*
feature — no LLM, no inferred intent.

**What it is:** coarse work themes derived from exact terms and conventional-commit
prefixes in the user's own commit **headlines** (e.g. `fix:` → Bug fix, `feat:` →
Feature, `security` → Security). Seven themes: Bug fix, Security, Performance,
Testing, Documentation, Refactor, Feature.

**What it is not:** a skill assessment, a specialisation claim, a productivity
score, or a hiring signal (see §13 exclusions). A theme means "N commit headlines
contained a term from this theme's rule set" — nothing more.

**Honesty constraints (binding):**
- Percentages are computed over **themed commits only**; the denominator is always displayed.
- Every commit falls into exactly one bucket: a theme, `unclassified`, `noMessage`, or `noise` (maintenance). Counts reconcile: `totalCommits = themedCommits + unclassified + noMessage + noise`.
- When no commits qualify, the UI shows an honest empty state — never a fabricated distribution.
- Every theme carries a confidence level (High/Medium/Low) and bounded evidence.
- Commit **bodies** (`messageFull`) are never scanned or exposed. Headline samples are bounded to 5 per theme.
- No theme is ever asserted about a developer's skill, intent, or capability.

**Scope boundaries (v1):** cross-repository aggregation only; per-repository filtering
is a future extension. Computed on demand, never persisted. No new dependency, no new
model, no new endpoint.

**Proposed Phase 10.2 (2026-10-20, awaiting owner approval):** per-repository theme
drill-down — the same classifier and taxonomy applied to one repository, surfaced on the
existing Repositories page. Reuses the already-ingested commits; no new data source, no
persistence, no new taxonomy. Tracked as a proposed task in `tasks.md` (Phase 10.2).

**Phase 10.2 — per-repository theme drill-down (APPROVED 2026-10-20, implemented
locally, remediated 2026-10-21; NOT deployed).** The owner approved: (1) a `repoThemes`
map delivered in the existing `GET /api/repos` response; (2) placement on the existing
Repositories page; (3) a top-theme chip per repository row. The same seven themes, rules,
precedence and honesty constraints apply — a per-repository view is the same classifier
scoped to one repository, never a second taxonomy. Percentages use that repository's
themed-commit denominator, which is always displayed. A repository with no themed commits
shows **no chip at all** — a top theme is never invented. Bounded evidence (≤20 SHAs, ≤5
headline samples); commit bodies are never read or exposed.

Implementation notes that constrain the product contract:
- The map is **opt-in** (`includeThemes=true` on `GET /api/repos`). It is the largest
  part of the response, and only the Repositories page uses it.
- The chip and the drill-down's first row always name the same theme: one ranking rule
  (confidence → commit count → theme priority → name) orders both.
- Every repository on the page keeps its own recent commits. A busy repository can
  never consume a quiet repository's evidence budget — a quiet repository's chip must
  never disappear because another repository was busy.
- The chip, the panel heading and the disclosure control each name the repository, so
  two open drill-downs are distinguishable to a screen reader.

---

## 13. Explicitly Out-of-Scope Features

The following will **not** be built in MVP or V1 and must not have tasks created for them:

1. Automated hiring scores, candidate ranking, or "talent" grading.
2. Employee surveillance / manager monitoring dashboards.
3. Cross-user leaderboards or public comparisons.
4. AI-generated skills/achievements without evidence.
5. Automatic code-quality or "10x engineer" judgments.
6. Social feed, follows, likes, comments.
7. Mobile native apps.
8. Real-time collaboration editing.
9. Billing / subscriptions (defer until product-market fit; architecture must not hard-block it but no billing work now).
10. Public API for third parties.

---

## 14. Functional Requirements

- FR-1: User can start GitHub OAuth and complete login without seeing tokens.
- FR-2: System stores GitHub token encrypted, linked to user, never sent to client.
- FR-3: User can trigger initial sync and observe progress to completion or error.
- FR-4: System ingests repos, commits, PRs, issues, languages within documented caps and stores normalized records.
- FR-5: User can view overview dashboard for 30d / 90d / 12m ranges.
- FR-6: User can view timeline with daily/weekly buckets and repo filter.
- FR-7: User can view repo list sorted by activity/recency and open repo detail.
- FR-8: User can view language breakdown and focus areas with confidence + evidence.
- FR-9: User can read insights, each expandable to evidence (counts, repos, dates).
- FR-10: User can manually resync; UI shows last-synced and per-resource status.
- FR-11: User can disconnect and delete all synced data; system confirms completion.
- FR-12 (V1): User can request AI paraphrase of an insight; system shows it alongside numbers + evidence link, or falls back to template text.
- FR-13 (V1): Webhook events update stored data incrementally within minutes (best-effort, rate-limit aware).
- FR-14: Every data-driven view has defined loading, empty, and error states (see §20).

---

## 15. Non-Functional Requirements

- NFR-1 Performance: overview dashboard p95 < 2.5s on broadband for accounts ≤100 repos (cached aggregates); timeline interactions < 300ms client-side after load.
- NFR-2 Scalability (MVP): single Node process + MongoDB Atlas (or local Mongo) supports 100 connected users with staggered syncs; architecture allows horizontal API + worker split later (see `architecture.md`).
- NFR-3 Reliability: sync jobs are idempotent and resumable; partial failures don't corrupt prior good data; retries with exponential backoff.
- NFR-4 Rate-limit citizenship: respect GitHub rate limits; queue + backoff; never exceed secondary limits via concurrency caps (default ≤2 concurrent GitHub requests per sync in MVP).
- NFR-5 Maintainability: module boundaries per `architecture.md`; no intelligence logic in route handlers; no GitHub calls outside `services/github/`.
- NFR-6 Observability: structured logs with request/job IDs; `/api/health` returns DB + GitHub reachability; sync job history persisted.
- NFR-7 Accessibility: WCAG 2.1 AA for core flows (see `design_system.md` §28).
- NFR-8 Responsiveness: usable at 360px–1440px; sidebar collapses; charts degrade gracefully.
- NFR-9 Configurability: AI provider, sync caps, scheduler intervals via env vars; no hardcoded secrets.

---

## 16. Data Requirements

Authoritative raw data (from GitHub API):

- `users`: githubId, login, avatarUrl, profileUrl.
- `repositories`: githubId, owner, name, fullName, visibility, primaryLanguage, stars, fork flag, defaultBranch, updatedAt.
- `commits`: sha, repoId, authorGithubId/date, message (first line + full), additions/deletions (where available), files touched (path list capped).
- `pullRequests`: githubId/number, repoId, author, state, created/merged/closedAt, additions/deletions, changedFiles, reviewers.
- `issues`: githubId/number, repoId, author/assignees, state, labels, created/closedAt.
- `languages`: per-repo byte map + fetchedAt.
- `syncStates`: per-user per-resource `lastSyncedAt`, `status`, `cursor`, `error`.

Derived data (computed, never hand-edited):

- Daily/weekly activity buckets per user (and per repo).
- Language aggregates + focus-area tags with confidence.
- Consistency metrics (active days, streaks), deltas, repo health labels.
- Insights (templateId + metrics + evidence refs).

Retention: raw + derived tied to user; deleted on user request within documented SLA (MVP: immediate delete operation + confirmation; automated backup purge documented as limitation). No cross-user derived data in MVP.

Data quality rules:

- Deduplicate by GitHub IDs (unique indexes).
- Store `fetchedAt` and `source` (rest/webhook) on every synced record.
- Never overwrite a newer record with older webhook data (compare timestamps).
- Counts always state scope + time range in UI ("Commits (authored by you, last 90d, synced repos only)").

---

## 17. GitHub Integration Requirements

- OAuth App (not GitHub App for MVP — simpler; revisit for org-level permissions in Future).
- Scopes (MVP): `read:user` + `repo`. Justification: `repo` needed to include private repos the user can access, which is core to "understands how you build". Settings page states this plainly + offers future public-only mode (post-MVP).
- Token storage: encrypted at rest (AES-256-GCM via env key; see `architecture.md` security boundaries), never logged, never sent to client.
- API client: Octokit REST in MVP. Endpoints: `GET /user`, `GET /user/repos`, `GET /repos/{owner}/{repo}/commits`, `GET /repos/{owner}/{repo}/pulls`, `GET /repos/{owner}/{repo}/issues`, `GET /repos/{owner}/{repo}/languages`. Pagination + `since`/`per_page` (max 100). Conditional requests via ETag where supported.
- Sync caps (MVP defaults, env-overridable): max 100 repos per user, max 500 commits per repo per full sync (12-month window), max 300 PRs/issues per repo. Caps disclosed in UI ("Showing first 100 repos — raise limits in settings (V1)" is out for MVP; MVP just states caps).
- Rate limits: read `x-ratelimit-remaining/reset` on every response; pause when remaining < 10% or on 403/429; exponential backoff; concurrency ≤2; job-level timeout.
- Webhooks (V1): `push`, `pull_request`, `issues`, `ping`; HMAC-SHA256 signature verification; event dedupe by delivery ID.

---

## 18. Intelligence Requirements (deterministic — no LLM)

All intelligence in MVP is computed in `services/intelligence/` with pure functions + unit tests. No LLM calls.

Required computations:

1. **Timeline aggregation:** bucket events by day (30d) / week (90d/12m). Output: `{ bucketStart, commits, prsOpened, prsMerged, issuesTouched }`.
2. **Language aggregation:** weighted bytes by user's commit share per repo (documented heuristic) + commit-count share. Output both; UI labels method.
3. **Focus-area tagging:** deterministic keyword/path/language rules (versioned, e.g., `focusRules v1`). Output: `{ tag, confidence, evidence: [repoNames, filePaths sample] }`. Confidence drops to Low when sample < threshold.
4. **Consistency:** active-day definition (fixed), active-days count, longest streak, current streak, quiet gaps list.
5. **Deltas:** current vs. prior equal period % change; suppressed when base < 5 ("Insufficient data").
6. **Repo health:** rule: Active (commit ≤7d), Steady (≤30d), Quiet (≤60d), Stalled (>60d) + open-issue/PR counts. No value judgments beyond label + "last activity X days ago".
7. **Insights:** rule engine evaluates templates (§9/F8) in fixed priority, emits ≤8 insights with metrics + evidence IDs + confidence.

Honesty rules:

- Every displayed metric includes time range + scope in subtitle or tooltip.
- Small samples show "Low confidence — small sample" badge.
- Gaps show neutral language.
- No "skill mastery" claims. Allowed: "Recent work concentrated in API-related repos (Medium confidence, 24 commits across 3 repos)". Forbidden: "You are an expert backend engineer."

---

## 19. AI Requirements (V1 — explanation only)

Strict contract (enforced in `services/ai/`):

- **Input:** `{ insightTemplateId, insightText, metrics: {...}, evidenceSummary: {...}, timeRange }`. Nothing else. No raw commit messages beyond aggregated counts unless user explicitly expands (to limit prompt-injection surface).
- **Output:** `{ paraphrase: string (≤80 words), whyItMatters?: string (≤30 words) }`. No numbers that are not in input. System prompt instructs: "Do not invent numbers, repos, dates, or skills. If input is insufficient, say so."
- **Validation:** backend checks output contains no new numbers/repos via allowlist comparison; on violation, discard AI output and show template text + log incident.
- **Provider abstraction:** `AIExplainer` interface with `TemplateExplainer` (no-op, MVP default) and `LlmExplainer` (OpenAI-compatible, V1). Model name, base URL, API key via env. Timeout 10s, 1 retry, graceful fallback.
- **UX:** AI text labeled "AI summary (beta)" with "View evidence" always adjacent. User can disable AI in settings. No AI on first paint — user clicks "Explain" per insight (saves cost, makes opt-in explicit).
- **MVP:** `TemplateExplainer` only. No LLM dependency installed as required runtime; LLM SDK (if any) is optional/dev-only until V1.

---

## 20. Error / Empty / Loading States

Every data view must implement all three (see `design_system.md` §§24–26 for visuals):

- **Loading:** skeleton cards/charts + progress for sync ("Syncing commits 45/120…"). No blank screens. Sync progress polling every 2s.
- **Empty:**
  - No repos connected → "Connect GitHub to get started" CTA.
  - No activity in range → "No recorded activity in this range. Try 90d or resync." + illustration, not shame.
  - New user mid-sync → progress, not empty.
- **Error:**
  - GitHub rate-limited → "GitHub rate limit reached. Resumes automatically at HH:MM. [Retry]".
  - Token revoked/expired → "GitHub connection expired. [Reconnect]".
  - Sync failed for one repo → per-repo warning, rest of dashboard still renders.
  - AI unavailable → silently fall back to template text + subtle "AI summary unavailable" note (no blocking error).
  - 404 repo / deleted → "This repository is no longer accessible. It was last synced at …".

Global: toast for transient failures, inline error card with retry for view-level failures, full-page error only for auth/session loss.

---

## 21. Security / Privacy Requirements

- OWASP baseline: input validation (zod) on all API inputs, output encoding (React default), parameterized queries (Mongoose), CSRF via `state` + SameSite cookies, XSS headers, no secrets in client bundle.
- Auth: GitHub token encrypted at rest (AES-256-GCM, key from env, rotation documented in architecture); app session JWT (HS256, 15-min access + 7-day refresh rotation, httpOnly + Secure + SameSite=Lax); logout clears cookies + optional GitHub revoke.
- AuthZ: every data route checks `req.user.id === resource.userId`. No IDOR. No admin endpoints in MVP.
- Secrets: only via env vars (`.env.example` documents keys, never values). No secrets in git, logs, or client.
- GitHub data minimization: fetch only listed resources; cap file-path storage; truncate commit messages at 500 chars; never store diffs in MVP.
- Privacy: no analytics/tracking in MVP; no third-party scripts; data never shared; delete-on-request; user can export (V1 CSV) and delete.
- Headers: `Content-Security-Policy`, `Strict-Transport-Security` (prod), `X-Content-Type-Options`, `Referrer-Policy` set in Express.
- Dependency hygiene: `npm audit` clean on High/Critical before merge; Dependabot or manual audit documented in `rules.md`.

---

## 22. Success Criteria

MVP launch success (first 4 weeks, single-operator friendly):

- 5+ real developers connect accounts and reach dashboard without assistance.
- Median time connect → first insight < 3 min (for ≤50 repos).
- ≥80% of shown insights rated "accurate" in hallway test (ask: "does this match what you did?").
- Zero fabricated-data incidents (any AI/number mismatch = P0 bug).
- Sync success rate ≥95% (excluding user-revoked tokens and GitHub outages).
- No High/Critical `npm audit` issues, no leaked secrets.

V1 success adds: AI summaries shown with evidence link 100% of time; webhook freshness p95 < 5 min; weekly retained users (2nd sync within 7 days) ≥40%.

---

## 23. Acceptance Criteria (MVP sign-off checklist)

- [ ] OAuth login/logout/disconnect works; token never visible in client or logs.
- [ ] Initial sync completes for a 20-repo test account; progress shown; last-synced timestamps correct.
- [ ] Dashboard renders overview, timeline, languages, top repos, insights for 30d/90d/12m.
- [ ] Every insight expands to evidence (counts, repos, dates) matching DB records.
- [ ] Timeline buckets match direct DB counts (spot-check script passes).
- [ ] Language + focus areas show method + confidence; small samples flagged.
- [ ] Rate-limit simulation (mock 403) pauses sync and shows correct message.
- [ ] Revoked-token flow shows reconnect CTA, no crash.
- [ ] Delete-data removes all user records (verified by DB query) + confirmation UI.
- [ ] All views have loading/empty/error states (manual walkthrough).
- [ ] Lighthouse accessibility ≥90, no critical axe violations on dashboard.
- [ ] `npm run build` + `npm run lint` + `npm test` pass on clean checkout.

---

## 24. Future Scalability Considerations (non-binding, architecture must allow)

- Split API + workers (BullMQ + Redis) without rewriting intelligence functions (they stay pure).
- Multi-user scheduling with per-user queues and priority (recently active first).
- Read replicas / aggregate collections for dashboard (pre-computed rollups) when Mongo queries slow.
- GitHub App migration for finer permissions + org installs.
- Feature-flagged AI providers; prompt versioning; eval set of insight→paraphrase pairs.
- No premature microservices, no Kubernetes, no multi-region in MVP/V1. Single deployable + managed Mongo is correct until metrics say otherwise.

---

## Appendix A — Glossary

- **Evidence:** the DB records + aggregate numbers that produced an insight.
- **Insight:** a human-readable sentence generated by a deterministic template + metrics.
- **AI summary:** an LLM paraphrase of an insight; never a source of numbers.
- **Active day:** a day with ≥1 authored commit OR merged PR OR qualifying issue event (fixed definition, versioned).
- **Focus area:** a coarse work theme (API, Frontend, Database, DevOps, Docs) from deterministic rules, always with confidence.
- **Commit theme (Phase 10.1):** a coarse work theme (Bug fix, Security, Performance, Testing, Documentation, Refactor, Feature) derived from exact terms and conventional-commit prefixes in the user's commit headlines. Always with confidence, always with a stated denominator. Never a claim about skill or intent.

## Appendix B — Open Decisions (require owner approval)

1. OAuth scopes: ship MVP with `repo` (includes private) or start public-only (`public_repo`) for less friction? **Recommendation:** `repo` with plain-language consent + public-only mode in V1. Needs approval.
2. Sync caps (100 repos / 500 commits per repo): acceptable for MVP? Needs approval.
3. AI provider choice for V1 (OpenAI-compatible default vs. specific vendor)? Deferred to V1; needs approval then.
4. Active-day definition (§18 + Glossary: authored commit OR merged PR OR qualifying issue event) — confirm as specified, or reduce to commits + merged PRs only? **Recommendation:** keep §18 definition (commits + merged PRs + qualifying issue events, versioned as ACTIVE_DAY_VERSION=1). Needs approval.
