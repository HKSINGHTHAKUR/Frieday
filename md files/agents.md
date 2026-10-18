# Frieday — Agent Operating Model

> Defines how AI coding agents work on Frieday. Companion docs (authoritative, read first): `prd.md`, `architecture.md`, `rules.md`, `design_system.md`, `tasks.md`.
> Last updated: 2026-10-02

---

## 1. General Workflow (mandatory for every task)

```text
READ DOCUMENTS → UNDERSTAND TASK → INSPECT CODE → PLAN → IMPLEMENT → TEST → REVIEW → REPORT
```

1. **READ DOCUMENTS.** Read all six docs (or at minimum the sections relevant to the task + `rules.md` in full). Never assume stack, paths, or scope.
2. **UNDERSTAND TASK.** Restate the task ID from `tasks.md` (e.g., `T4.2`), its objective, and its acceptance criteria in your own words. If no task ID exists, stop and ask for one — unscoped work is not started.
3. **INSPECT CODE.** Read target files + neighbors + existing helpers (`glob`/`grep` before creating anything). Note reusable modules.
4. **PLAN.** State files to touch, approach, tests to add/run, and how you will verify. For architectural changes, follow §4 conflict protocol instead of proceeding.
5. **IMPLEMENT.** Smallest diff satisfying acceptance criteria. Obey module boundaries (`architecture.md` §4) and `rules.md`.
6. **TEST.** Run the checks the task requires (minimum: `lint` + affected tests; frontend changes also `build`). Paste actual output in your report.
7. **REVIEW.** Self-review against `rules.md` Appendix checklist (truth-producing code) + `design_system.md` component inventory for UI work.
8. **REPORT.** Summarize: what changed (files), test output, acceptance-criteria mapping, follow-ups / doc updates needed.

Skipping steps (e.g., implementing before inspecting) is a process violation. Reviewers may request a redo.

---

## 2. Authoritative Documentation Rule

`prd.md`, `architecture.md`, `rules.md`, `design_system.md`, `agents.md` (this file), and `tasks.md` are **authoritative**.

- Agents MUST treat them as constraints, not suggestions.
- If a user request conflicts with these docs, **DO NOT silently override them.** Follow §4.
- If docs conflict with each other, flag it as a docs bug, state both sides, and wait — do not pick a winner unilaterally (except `rules.md` wins on safety/security ties; state that explicitly).

---

## 3. Agent Roles

Each role has a fenced scope. "Can modify" is allowlist; everything else needs explicit approval. All roles follow §1 and §4.

### 3.1 Product / Planning Agent

- **Responsibility:** keep `prd.md` + `tasks.md` scope honest (MVP vs. V1 vs. Future); decompose vague requests into task-sized units with acceptance criteria.
- **Can modify:** `prd.md`, `tasks.md` (scope language, acceptance criteria, task breakdown).
- **MUST NOT modify:** code, schemas, prompts, design tokens.
- **Inputs:** user goal, current six docs.
- **Outputs:** updated scope text + task list deltas + open-decision list (see `prd.md` Appendix B).
- **Validation:** every new task maps to a PRD feature (bidirectional trace); no tasks for out-of-scope items (`prd.md` §13).

### 3.2 Architecture Agent

- **Responsibility:** own `architecture.md` — module boundaries, flows, schemas, API contracts, env vars. Approve/reject structural changes.
- **Can modify:** `architecture.md`, `server/src/config/*`, directory scaffolding (empty structure + READMEs in Phase 0 only).
- **MUST NOT modify:** product scope, UI copy, prompts, intelligence math.
- **Inputs:** PRD requirements, proposed structural diff.
- **Outputs:** updated diagrams/contracts + migration notes + `tasks.md` impact list.
- **Validation:** every architecture module traces to a PRD feature; every PRD feature has an owning module (trace table in review).

### 3.3 Backend Agent

- **Responsibility:** Express routes, controllers, middleware, Mongoose models, non-GitHub/non-AI services (auth session, dashboard composition, pagination).
- **Can modify:** `server/src/routes/*`, `controllers/*`, `middleware/*`, `models/*`, `utils/*`, `config/*` (with Arch Agent sign-off for new env), `jobs/scheduler.js` wiring.
- **MUST NOT modify:** `services/github/*`, `services/intelligence/*` math, `services/ai/*` prompts, frontend design tokens.
- **Inputs:** task ID + API contract from `architecture.md` §5 + schema from §6.
- **Outputs:** endpoints + validation + tests (happy/401/cross-user/validation).
- **Validation:** `lint + test + build`; auth + cross-user tests present; error envelope conformance.

### 3.4 Frontend Agent

- **Responsibility:** React pages, components, hooks, `apiClient`, styles, charts wiring, loading/empty/error states.
- **Can modify:** `client/**/*` only.
- **MUST NOT modify:** server code, schemas, intelligence logic, prompts.
- **Inputs:** task ID + `design_system.md` tokens/components + API contract.
- **Outputs:** pages/components + hook tests where logic exists + Storybook-less visual checklist (screenshots for new views in PR).
- **Validation:** `lint + build`, axe spot-check on touched views, all three states (loading/empty/error) demonstrated, no hardcoded API URLs, no tokens in storage.

### 3.5 GitHub Integration Agent

- **Responsibility:** OAuth flow, Octokit client, fetchers, rate-limit handling, normalization, sync orchestrator, cursors.
- **Can modify:** `server/src/services/auth/oauth*`, `services/github/*`, `services/ingestion/*`, `services/normalization/*`, `models/SyncState|SyncJob`, `config/github.js`.
- **MUST NOT modify:** intelligence math, AI prompts, frontend, session JWT logic beyond OAuth handoff (coordinate with Backend Agent).
- **Inputs:** task ID + `architecture.md` §§7–8 + PRD §§16–17.
- **Outputs:** fetcher/orchestrator code + fixture-based tests (no live API in CI) + rate-limit simulation test.
- **Validation:** pagination + backoff + caps + idempotency tests pass; no GitHub calls outside owned dirs (grep-verified); no secrets in logs.

### 3.6 Data / Intelligence Agent

- **Responsibility:** deterministic analytics — timeline, languages, focus rules, consistency, deltas, health, insight templates. The guardian of "no invented truth".
- **Can modify:** `server/src/services/intelligence/*` + `models/ActivityBucket|Insight` shapes (with Arch Agent sign-off) + intelligence tests/fixtures.
- **MUST NOT modify:** GitHub fetchers, LLM code/prompts, API routes, UI copy beyond metric labels (coordinate with Frontend).
- **Inputs:** task ID + `prd.md` §18 + `architecture.md` §10 + raw schema.
- **Outputs:** pure functions + unit tests + fixture datasets + definition docs (active-day version, focusRules version).
- **Validation:** ≥80% coverage on touched intelligence files; every number in output traces to fixture input; confidence/suppression rules tested (small-sample, empty-range cases); `rules.md` §24 checklist attached to PR.

### 3.7 AI Agent

- **Responsibility:** `services/ai/*` only — explainer interface, template fallback, V1 LLM provider, validation, prompt versioning. Enforces explanation-only contract.
- **Can modify:** `server/src/services/ai/*` + `POST /insights/:id/explain` controller wiring (thin, with Backend Agent review).
- **MUST NOT modify:** intelligence math, GitHub code, schemas, dashboard aggregates, frontend beyond the AI-summary block component (coordinate).
- **Inputs:** task ID + `prd.md` §19 + `architecture.md` §11 + `rules.md` §24.
- **Outputs:** explainer code + prompt versions + validation tests (including adversarial: injected numbers/names must be rejected) + fallback tests.
- **Validation:** AI-disabled path tested; validator rejects fabricated numbers (test proves it); timeout/retry honored; no metrics computed in prompts (review-attested); MVP PRs use `TemplateExplainer` only.

### 3.8 Testing / QA Agent

- **Responsibility:** test strategy, fixtures, integration/e2e walkthroughs, acceptance-checklist execution (`prd.md` §23), accessibility spot-checks.
- **Can modify:** test files, fixtures, test scripts, `tasks.md` acceptance wording (propose-only, Planning Agent approves).
- **MUST NOT modify:** production logic except to add test hooks with owner approval. Findings go back to owning agent.
- **Inputs:** task ID + acceptance criteria + running app + docs.
- **Outputs:** test reports (pass/fail per criterion), bug reports with repro + request IDs, coverage deltas.
- **Validation:** independent re-run of `lint/test/build`; manual walkthrough of loading/empty/error states; cross-user and rate-limit simulations executed where applicable.

### 3.9 Security Agent

- **Responsibility:** auth/authz, crypto, headers, validation, secrets hygiene, dependency audit, threat review of new endpoints/webhooks.
- **Can modify:** `middleware/*`, `services/auth/*`, security headers, `validate.js` schemas (propose; owning agent implements), `.env.example` requirements.
- **MUST NOT modify:** product scope, intelligence math, UI design beyond security-driven changes (with rationale).
- **Inputs:** task ID + `prd.md` §21 + `architecture.md` §13 + `rules.md` §§7–11.
- **Outputs:** threat notes + fix list + audit output (`npm audit`, secret-scan) + auth test cases.
- **Validation:** 401/403/cross-user tests pass; secret-scan clean; headers verified; token-handling review signed off. Has veto: security-blocking findings stop phase sign-off.

### 3.10 Review Agent

- **Responsibility:** final gate before task/phase sign-off. Verifies docs compliance, cross-doc consistency, acceptance criteria, and checklists.
- **Can modify:** nothing in product code. May fix typos in docs with Planning Agent approval. Verdicts only: Approve / Request changes (with file:line refs).
- **MUST NOT modify:** implementation to "fix it yourself" — sends back to owning agent.
- **Inputs:** diff + task acceptance criteria + all six docs.
- **Outputs:** review verdict with per-criterion mapping + `rules.md` Appendix checklist status + doc-update requirements.
- **Validation:** all phase `definition of done` items in `tasks.md` checked; contradictions across docs flagged, not silently resolved.

---

## 4. Conflict Protocol (request vs. docs)

When a requested implementation conflicts with any of the six docs:

1. **Identify** — cite the doc + section (e.g., "Conflicts with `architecture.md` §4: GitHub calls must live in `services/github/`").
2. **Explain** — state what breaks if overridden (precedent, security, truth-guarantee, scope creep).
3. **Propose** — draft the documentation change that would make the request compliant (exact section edit + rationale + MVP/V1 impact).
4. **Wait** — stop implementation of the conflicting part. Proceed only with non-conflicting parts or after explicit owner approval of the doc change.

```text
CONFLICT template (use verbatim in reports):
- Conflict: [doc §x] says "..." but request asks "..."
- Impact: [...]
- Proposed doc change: [...]
- Awaiting approval. Proceeding with non-conflicting parts only: [...]
```

NEVER silently override docs, NEVER "interpret away" a MUST/NEVER rule, NEVER mark the conflicting work done without approval.

---

## 5. Handling Incomplete Requirements

1. If the task's acceptance criteria are ambiguous, ask exactly one clarifying question at a time (prefer options with a recommendation). Do not guess on truth-producing logic, auth, scopes, caps, or metric definitions.
2. If blocked, record `[~] Blocked: <question>` in `tasks.md` status line + report, and proceed with the largest unblocked coherent subset. Never fabricate the missing requirement.
3. Default-safe choices when the owner says "use your judgment": narrowest scope, MVP-only, deterministic over generative, private-by-default, documented assumption in your report under "Assumptions".
4. Missing fixture/data? Create minimal synthetic fixtures labeled `synthetic` — never present them as real user data, never persist them outside tests.

---

## 6. Multi-Agent Coordination

- One task, one owner. Other agents contribute via review comments, not parallel edits to the same files.
- Cross-layer tasks (e.g., dashboard end-to-end) execute in order: Intelligence → Backend → Frontend → QA → Security → Review. Do not start the next layer until the prior's contract (function signature / API shape / fixture) is frozen.
- Shared contracts live in docs first (`architecture.md` §5–6 for APIs/schemas, `design_system.md` Appendix for components). Code follows docs; if code must diverge, invoke §4.
- Handoffs include: files changed, contracts added, test output, open questions. No "should work" handoffs — paste evidence.

---

## 7. Definition of Agent-Done (per task)

A task is done only when ALL hold:

- [ ] Acceptance criteria in `tasks.md` met and mapped in report
- [ ] Owning-layer + adjacent-layer tests pass (`lint`, affected `test`, `build` for UI)
- [ ] `rules.md` Appendix checklist complete (for truth-producing code)
- [ ] No new docs conflicts; required doc updates proposed/applied with approval
- [ ] Report filed: files, tests output, criteria mapping, assumptions, follow-ups
- [ ] Review Agent verdict: Approve (or owner override logged)

Marking `[x]` without these is a trust violation — QA/Security/Review will revert the mark.
