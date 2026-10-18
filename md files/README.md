# Frieday — Developer Intelligence Platform

> "Frieday understands how you build software."

Single source of truth: `prd.md`, `architecture.md`, `rules.md`, `design_system.md`, `agents.md`, `tasks.md`.
Current phase: **Phase 9 — Production Deployment (T9.1 + T9.2 code complete; live-environment verification pending)**. Deployment/ops docs: `docs/deployment.md` + `RUNBOOK.md`. (Phase line reconciled by the Phase 0–9 audit, 2026-10-05.)

## Getting started

Requirements: Node.js >= 20, npm, (optional) a local MongoDB.

```powershell
# 1. Install all workspaces (root + client + server)
npm install

# 2. Configure environment
Copy-Item .env.example .env
# Fill in JWT_SECRET and TOKEN_ENC_KEY (server refuses to boot without them):
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Run client + server together (server :5000, client :5173)
npm run dev

# 4. Verify health
#   http://localhost:5000/api/health
```

## GitHub OAuth App setup (Phase 1)

1. GitHub → Settings → Developer settings → OAuth Apps → _New OAuth App_.
2. Callback URL: `http://localhost:5000/api/auth/github/callback` (must match `GITHUB_CALLBACK_URL`).
3. Scopes: `read:user`, `repo`.
4. Put the Client ID in `GITHUB_CLIENT_ID` and the Client Secret in `GITHUB_CLIENT_SECRET` (`.env` only — never in git).

Until the app is configured, `/api/health` reports `github: unconfigured` and the login CTA returns a `501 INVALID_CONFIG` envelope.

## Scripts (root)

| Script          | What it does                        |
| --------------- | ----------------------------------- |
| `npm run dev`   | Starts server + client concurrently |
| `npm run lint`  | ESLint + Prettier check             |
| `npm run test`  | Server tests (`node --test`)        |
| `npm run build` | Production build of the client      |

## Layout

- `client/` — React + Vite + Tailwind frontend (`architecture.md` §4)
- `server/` — Node + Express backend (`architecture.md` §4)
- `.env.example` — authoritative env list (`architecture.md` §17)

## Production deployment (Phase 9 — T9.1)

Production setup (env provisioning, MongoDB Atlas, GitHub OAuth + webhook, Docker,
backup/restore, delete-SLA, rollback, smoke test) is documented in
[`docs/deployment.md`](../docs/deployment.md). Quick path: `npm ci` →
`npm run build -w client` → `npm run start -w server` serves both the API and
the built client (`/api/health` for verification). Incident handling: [`RUNBOOK.md`](../RUNBOOK.md).

## Notes

- Phase 0 only: skeleton, validated config, `/api/health`, logging, app shell, design tokens.
- No GitHub calls, no product logic, no secrets in git. See `tasks.md` Phase 0 Definition of Done.
