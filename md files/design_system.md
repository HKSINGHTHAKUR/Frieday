# Frieday — Design System

> Single Source of Truth for visual and interaction design. Companion docs: `prd.md`, `architecture.md`, `rules.md`, `agents.md`, `tasks.md`.
> Stack: React + Vite + Tailwind CSS. Charts: Recharts (wrapped). Fonts: Inter (UI) + JetBrains Mono (code/numbers).
> Last updated: 2026-10-02

---

## 1. Design Philosophy

Frieday is a **serious developer intelligence instrument** — closer to Linear / GitHub / Vercel dashboards than to a marketing site or a generic "AI dashboard".

- **Clarity over decoration.** Every pixel serves comprehension. If an element doesn't help the user understand their work, remove it.
- **Evidence is the aesthetic.** Numbers, dates, and drill-downs are first-class visual citizens, not footnotes.
- **Calm density.** Developers tolerate information density; they do not tolerate clutter. Generous alignment, strict hierarchy, restrained color.
- **Honest data viz.** Never truncate axes to exaggerate, never hide small samples, never use dark patterns (fake streaks, shame language).

## 2. Brand Personality

- Competent, precise, understated. Quietly premium.
- Voice: factual, neutral, encouraging without hype. ("Active 18 of last 30 days." Not "You're crushing it! 🔥".)
- Never: playful-surveillance ("We watched you code!"), pseudo-scientific ("Your genius score: 97"), or hustle-shaming ("You slipped!").

## 3. Visual Direction

- Light theme default (developers read data better on light; dark theme is V1 backlog, tokens already structured for it).
- Solid surfaces, 1px borders, subtle shadows. No glassmorphism, no aurora gradients, no glow.
- Accent used sparingly: one primary action color, one data highlight, semantic colors for status.
- Monospace reserved for numbers, SHAs, dates in tables — tabular figures prevent jitter.
- Reference vibe: Linear's restraint + GitHub's data density + Vercel's typographic discipline.

## 4. Color System (tokens)

Tailwind configured with these CSS variables (`client/src/styles/index.css`). All text/background pairs meet WCAG AA (≥4.5:1).

**Surfaces (light):**

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#F7F8FA` | App background |
| `--surface` | `#FFFFFF` | Cards, panels |
| `--surface-2` | `#F1F3F5` | Hover fills, wells, code blocks |
| `--border` | `#E5E8EC` | Card/inputs dividers |
| `--border-strong` | `#D4D9DF` | Focus rings, table headers |

**Text:**

| Token | Value | Use |
|-------|-------|-----|
| `--text` | `#16191D` | Primary (15.8:1 on surface) |
| `--text-2` | `#4B5560` | Secondary (7.5:1) |
| `--text-3` | `#7A8490` | Tertiary/captions (4.6:1) |

**Brand / action:**

| Token | Value | Use |
|-------|-------|-----|
| `--accent` | `#2563EB` | Primary buttons, links, active nav (5.2:1 white-on-accent for button text) |
| `--accent-hover` | `#1D4ED8` | Hover |
| `--accent-soft` | `#E8EFFE` | Selected rows, info wells |

**Semantic:**

| Token | Value | Use |
|-------|-------|-----|
| `--success` | `#15803D` | Healthy, merged, positive deltas |
| `--success-bg` | `#E7F5EC` | |
| `--warning` | `#B45309` | Quiet, rate-limited, medium confidence |
| `--warning-bg` | `#FEF3E2` | |
| `--danger` | `#DC2626` | Failed, stalled, errors |
| `--danger-bg` | `#FDECEC` | |
| `--info` | `#4F46E5` | AI-summary label, neutral info |

**Chart palette (colorblind-safe, max 6 series, always with labels):**

```text
--chart-1 #2563EB (commits / primary)
--chart-2 #7C3AED (PRs opened)
--chart-3 #059669 (PRs merged / success)
--chart-4 #D97706 (issues)
--chart-5 #64748B (baseline / prior period, dashed)
--chart-6 #DB2777 (highlight, sparing)
```

Language colors follow GitHub Linguist hues where recognizable (JS yellow, TS blue, Python blue/green, Go cyan) but desaturated ~15% to sit in this system; unknown languages fall back to `--chart-*` in order.

**Dark theme (V1, tokens reserved):** `--bg #0B0D10`, `--surface #12151A`, `--text #E8EAED`, accent stays `#5B8DEF` for contrast. Do not design dark-specific components in MVP; keep tokens semantic so the flip is mechanical.

## 5. Typography

- UI: **Inter** (system fallback: `-apple-system, "Segoe UI", sans-serif`). Code/numbers: **JetBrains Mono** (fallback `ui-monospace, monospace`).
- Rendering: `font-feature-settings: "tnum" 1, "cv05" 1` for tabular numbers in metrics.

## 6. Font Hierarchy

| Role | Size / Weight / Line-height | Use |
|------|-----------------------------|-----|
| Page title | 20px / 650 / 28px | "Overview", "Repositories" |
| Section title | 15px / 650 / 22px | Card titles, panel headers |
| Body | 14px / 400 / 21px | Default text, table cells |
| Caption | 12.5px / 400 / 18px | Metric scope labels, axis ticks, helper text |
| Micro | 11.5px / 500 / 16px, uppercase + 0.04em tracking | Eyebrows ("LAST 90 DAYS", "EVIDENCE") |
| Metric XL | 28px / 700 / 32px, mono for digits | KPI card values |
| Metric L | 20px / 700 / 28px | Secondary stats |
| Code | 12.5px mono | SHAs, paths, dates in tables |

Scale is fixed (no fluid type in MVP). Long titles truncate with ellipsis + full text in tooltip.

## 7. Spacing System

4px base. Allowed: `4, 8, 12, 16, 20, 24, 32, 48`. No arbitrary values (Tailwind config restricts spacing scale; `rules.md` lint rejects `p-[13px]`).

- Card padding: 20px (16px on mobile). Page gutter: 24px desktop / 16px mobile. Section gap: 24px. Card grid gap: 16px. Tight inline gap: 8px.

## 8. Grid System

- App shell: fixed sidebar 248px + fluid content (max 1200px, centered). Content grid: 12 columns, 16px gutters.
- Dashboard composition: KPI row (4 × 3-col cards) → main chart (8-col) + side rail (4-col: languages + streak) → bottom row (repos table 8-col + insights 4-col). See §16.
- Breakpoints: `sm 640`, `md 900` (sidebar collapses to icons), `lg 1200`. Below 900px: single column, KPIs 2×2.

## 9. Border Radius

`--r-sm 6px` (badges, inputs, tooltips), `--r-md 10px` (cards, modals, dropdowns), `--r-lg 14px` (large panels, empty-state illustrations' container), `--r-full 999px` (pills, avatars). No larger radii; no squircle experimentation.

## 10. Shadows

- `--shadow-sm: 0 1px 2px rgba(16,24,40,.06)` (cards at rest).
- `--shadow-md: 0 4px 12px rgba(16,24,40,.10)` (hover lift, dropdowns).
- `--shadow-lg: 0 12px 32px rgba(16,24,40,.16)` (modals, toasts).
- No colored shadows, no glow, no multi-layer fashion shadows.

## 11. Cards

- Anatomy: surface bg, 1px `--border`, `--r-md`, `--shadow-sm`; header (section title + optional action link right), body (20px padding), optional footer (caption + link).
- KPI card: micro eyebrow (range + scope) → metric XL + delta badge → caption ("vs. prior 30d"). Delta badge: `▲ 12%` green / `▼ 8%` slate (never red for down-activity — down is neutral, not failure) / `—` when suppressed ("n/a — small sample").
- Insight card: template text (body) + confidence badge + metric chips (numbers) + "View evidence" expander + (V1) "AI summary (beta)" block in `--accent-soft` well.
- Hover: border stays, shadow `sm→md` only on clickable cards. No scale transforms.

## 12. Buttons

- Variants: `primary` (accent fill, white text), `secondary` (surface, border, text), `ghost` (text-only), `danger` (danger fill for Delete data only, requires confirm modal).
- Sizes: `sm` (28px), `md` (36px, default), `lg` (44px, login CTA only).
- States: hover (darken 8%), active (darken 12%), disabled (40% opacity + `not-allowed`, with reason in tooltip), loading (spinner + label stays, e.g., "Syncing…").
- Rules: one primary per view. Destructive actions need a typed confirm (`DELETE` or checkbox) — see §22. Focus ring: 2px accent offset 2px, always visible.

## 13. Inputs

- Text/select/date: 36px height, surface bg, 1px `--border-strong`, `--r-sm`, 14px text; focus: accent 2px ring; error: danger border + message below with icon.
- Range selector: segmented control (30d | 90d | 12m), single-select, URL-synced. Repo filter: searchable select, "All repos" default.
- Labels: 12.5px medium above input; helper/caption below in `--text-3`. No placeholder-as-label.

## 14. Navigation

- Topbar (56px): logo mark "Frieday" (wordmark, no mascot), environment-agnostic; right side: sync status pill + "Sync now" button + avatar menu (Settings, Disconnect, Logout).
- Sidebar (248px): sections — Overview, Timeline, Repositories, Insights, Settings. Active: accent-soft bg + accent left indicator (3px) + semibold label. Icons: 16px outline set (single library — Lucide — no emoji icons).
- Breadcrumbs on RepoDetail (`Repositories / owner/name`). Back button preserves filter state via URL params.

## 15. Sidebar

- Collapses to 64px icon rail <900px (tooltips on hover), hidden behind hamburger <640px (slide-over with scrim).
- Bottom block: connection card (avatar + login + "Last synced Xm ago" + status dot). Status dot: green synced <24h, amber syncing/rate-limited, red failed/token issue.
- No secondary sidebars. Repo detail uses content-column layout, not a second nav.

## 16. Dashboard Layout (authoritative wireframe)

```text
┌──────────────────────────────────────────────────────────┐
│ Topbar: Frieday | search(cmdk V1) | sync pill | Sync now | avatar │
├────────┬─────────────────────────────────────────────────┤
│ Side   │ Greeting row: "Your last 90 days" + range seg + repo filter │
│ bar    │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                       │
│        │ │KPI │ │KPI │ │KPI │ │KPI │  Active repos/commits/│
│ Over-  │ │    │ │    │ │    │ │    │  PRs/active days      │
│ view   │ └────┘ └────┘ └────┘ └────┘                       │
│ Time-  │ ┌──────────────────────┐ ┌───────────────────┐   │
│ line   │ │ Activity chart       │ │ Languages donut   │   │
│ Repos  │ │ (commits+PRs, hover  │ │ + focus tags w/   │   │
│ In-    │ │ tooltip, prior dashed)│ │ confidence badges │   │
│ sights │ └──────────────────────┘ └───────────────────┘   │
│ Set-   │ ┌──────────────────────┐ ┌───────────────────┐   │
│ tings  │ │ Top repos table      │ │ Insights feed     │   │
│        │ │ (5 rows + View all)  │ │ (top 4 + View all)│   │
│        │ └──────────────────────┘ └───────────────────┘   │
└────────┴─────────────────────────────────────────────────┘
```

Rules: KPI values from `GET /dashboard` only; chart + table share the same bucket payload (no divergent queries); every number has caption/tooltip with scope; "View all" links preserve range.

## 17. Charts

- Library: Recharts wrapped in `components/charts/*`. Theme: grid `#EDF0F3`, axis ticks caption color, tooltip = surface card with mono numbers, no chartjunk.
- **Activity chart:** grouped bars (commits) + lines (PRs opened/merged); prior-period dashed gray overlay toggle; y-axis starts at 0 always; empty buckets shown as gaps with note, not interpolated.
- **Language donut:** max 5 slices + "Other"; center label = top language share; legend with bytes + % + commit share; hover shows method note ("weighted by your commits per repo").
- **Sparklines (repo rows):** 8-week mini bars, no axes, tooltip on row hover only.
- Anti-noise rules: max 4 series per chart; direct labels over legends where space allows; no 3D, no gradients fills (flat 12% opacity area under lines max), no animated drawing on load (render final state; transitions only on filter change ≤200ms).

## 18. Data Visualization (intelligence communication)

- Every chart answers one question, stated in its title ("Commits and PRs per week — last 12 weeks").
- Uncertainty is visualized: low-confidence focus tags get dashed outline + "Low" badge; suppressed deltas show `n/a` with reason, not 0%.
- Health badges map to semantic colors but always include text (Active green / Steady slate-blue / Quiet amber / Stalled gray-red) — never color-only.
- Evidence pattern: any insight sentence → "View evidence" expands inline table (repos, counts, dates) + link to filtered Timeline/RepoDetail. V1 AI summaries sit below template text in a labeled well, never replacing it.

## 19. Tables

- Header: 11.5px uppercase micro in `--text-3`, 1px bottom border `--border-strong`, sticky on scroll. Rows: 48px, 1px `--border` dividers, hover `--surface-2`. Mono for SHAs/counts/dates. Right-align numbers.
- Repo table columns: Repository (avatar+name+visibility badge) | Health | Commits (range) | PRs | Issues | Last activity | Sparkline. Sortable: activity, recent, name. Pagination footer: "1–20 of N" + prev/next (cursor).
- Row click → detail. Keyboard: rows focusable, Enter opens.

## 20. Badges

- Pills, `--r-full`, 11.5px medium, icon + text. Variants: `neutral` (visibility, counts), `success` (Active, Merged), `warning` (Quiet, Medium confidence, Rate-limited), `danger` (Stalled, Failed), `info` (AI summary beta, New).
- Confidence badges: `High` (solid outline), `Medium` (warning), `Low` (dashed outline + tooltip "small sample — treat cautiously").

## 21. Tooltips

- Dark tooltip (`#1A1E24` bg, white 12.5px text, `--r-sm`, 8px padding, max 280px). Trigger: hover + focus. Content: exact value + scope + method note ("Active day = ≥1 commit or merged PR. Week starts Monday UTC.").
- Chart tooltips: rich (date range, per-series values, total). Never show Nova-only metrics without definition.

## 22. Modals

- Centered, max 480px, scrim `rgba(16,24,40,.45)`, `--shadow-lg`, Escape + scrim-click dismiss (except destructive confirm while processing). Focus trap + return focus.
- Destructive (Delete data, Disconnect): danger header icon, plain-language consequences list, typed confirm (`DELETE`), two-step (confirm → processing → success confirmation screen, not just toast).

## 23. Toasts

- Bottom-right stack, max 3, auto-dismiss 5s (errors persist until dismissed). Types mirror badges. Content: title + one-line action ("Sync complete — 42 repos updated. [View]") / error with Retry button inline.
- `aria-live="polite"`; errors `role="alert"`.

## 24. Loading States

- Skeletons: card-shaped shimmer (`--surface-2` pulse, no spinner soup) matching final layout; chart skeleton shows axes + gray bars; table skeleton shows 5 gray rows.
- Sync: dedicated progress card (phase label + `done/total` + determinate bar + "You can leave — sync continues" note). Polling indicator: subtle pulsing dot in sync pill, not a blocking overlay.
- Buttons in flight: spinner replaces icon, label stays truthful ("Syncing…", not "Loading…").

## 25. Empty States

- Pattern: 40px neutral illustration (geometric, no stock faces) + 15px semibold title + body (cause, no blame) + primary action.
- Copy bank: no repos → "No repositories synced yet" / "Connect GitHub or run Sync to populate your dashboard. [Sync now]"; no activity in range → "No recorded activity in this range" / "Try a longer range or check unsynced/private repos. [View 90d]"; no insights → "Not enough data for insights yet" / "Insights appear after your first full sync with 5+ events."
- Never show zero-state charts with fake flatlines — show the empty pattern instead.

## 26. Error States

- Inline error card: danger-tinted well + icon + title + cause + Retry + "Details" expander (request ID, no stack). Per-repo sync warnings: amber row banner, rest renders.
- Rate-limited: clock icon + "GitHub rate limit reached — resumes automatically at HH:MM" + countdown + [Retry now] (disabled until reset).
- Token expired: key icon + "GitHub connection expired" + [Reconnect GitHub].
- AI unavailable (V1): no error card — template text renders + subtle caption "AI summary unavailable — showing computed summary."
- Full-page error only for: logged-out (→ login), app-config failure. Everything else is inline.

## 27. Responsive Behavior

- ≥1200px: full grid (§16). 900–1200px: charts stack (chart full-width, languages+streak side-by-side below). <900px: sidebar → icon rail; KPIs 2×2; tables → card list (repo rows become stacked cards, sparkline hidden). <640px: single column; topbar condenses (Sync button → icon); charts height 220px; tables horizontally scroll with sticky first column instead of squishing.
- Touch: targets ≥44px on mobile; tooltips become tap-to-open; no hover-only actions.

## 28. Accessibility (WCAG 2.1 AA — enforces `rules.md` §20)

- Contrast: all pairs in §4 pass AA; chart grid/axis decorative only (data always has text equivalent via table toggle "View as table").
- Keyboard: full flow operable (login → sync → dashboard → detail → settings); visible focus rings; skip link "Skip to content"; modal focus trap; chart container focusable with arrow-key point readout (`aria-label` per point).
- Screen readers: landmarks (`nav`, `main`, `table` with `<caption>`), `aria-live` sync progress + toasts, badges expose text (not color), deltas read as "up 12 percent versus prior period", icons `aria-hidden` with adjacent text.
- Motion: `prefers-reduced-motion` disables shimmer/transitions (static placeholders); no auto-playing animation anywhere.
- Gate: `axe`-clean on Dashboard/Repos/Settings + Lighthouse accessibility ≥90 before MVP sign-off.

## 29. Motion / Animation Principles

- Purpose-only motion: state change confirmation (toast slide 160ms), filter transitions (chart crossfade ≤200ms), progress (determinate bar). No entrance choreography, no parallax, no looping decoration.
- Easing: `cubic-bezier(.2,.7,.3,1)` (ease-out). Durations: micro 120ms, standard 200ms, modal 240ms. Nothing exceeds 300ms.
- Skeleton shimmer: subtle opacity pulse (not sliding gradient) to respect reduced-motion.

---

## Appendix — Token Reference (Tailwind mapping)

```js
// tailwind.config.js (authoritative subset)
colors: {
  bg: 'var(--bg)', surface: 'var(--surface)', surface2: 'var(--surface-2)',
  border: 'var(--border)', borderStrong: 'var(--border-strong)',
  text: 'var(--text)', text2: 'var(--text-2)', text3: 'var(--text-3)',
  accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', soft: 'var(--accent-soft)' },
  success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)',
  chart1..chart6: 'var(--chart-1..6)',
}
borderRadius: { sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)' }
boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' }
```

Component inventory (must exist before Phase 5 is marked done): `Button, Card, Badge, Input, Select, SegmentedControl, Modal, Toast, Tooltip, Skeleton, EmptyState, ErrorCard, SyncProgress, InsightCard, EvidenceExpander, RepoRow, ActivityChart, LanguageDonut, MetricCard`. Missing primitives block phase sign-off.
