# syntax=docker/dockerfile:1
# Frieday production image (Phase 9, T9.1 — Option A).
#
# Single process serving BOTH the production client build and the API:
#   Browser → same-origin frontend (client/dist) → /api → server → MongoDB/GitHub
#
# - Deterministic deps: npm ci from the committed lockfile.
# - Multi-stage: the builder compiles the client and prunes dev tooling; the
#   runtime image ships only production node_modules + server source + client/dist.
# - MongoDB stays an EXTERNAL managed service (Atlas) — not a container here.
# - No Redis/BullMQ (architecture.md §18.4; the node-cron scheduler remains).
# - No secrets baked in: every value comes from runtime environment variables.

# ---------- Stage 1: builder ----------
FROM node:20-bookworm-slim AS builder
# devDependencies (incl. vite) must be installed so the client can build;
# they are pruned after the build via `npm prune --omit=dev` below.
WORKDIR /app

# Lockfile-first so dependency layers are cached independently of source.
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

# Source + build the client, then drop dev-only tooling from node_modules.
COPY client/ ./client
COPY server/ ./server
RUN npm run build -w client && npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app

# Runtime artifacts only: pruned production dependencies, server source, and
# the compiled client (server/src/app.js serves it — T9.1 Option A).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/dist ./client/dist
COPY package.json ./

# Run as the unprivileged `node` user (the app writes no files at runtime).
USER node

EXPOSE 5000

# Liveness: /api/health must answer OK (DB status is reported, not fatal — the
# process is alive even if Mongo is briefly unreachable; boot fail-fast covers
# the real startup failure mode per config/db.js production path).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
