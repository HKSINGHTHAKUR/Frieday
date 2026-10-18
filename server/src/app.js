/**
 * Express app factory (no listen here — see index.js).
 * Security baseline per rules.md §9: helmet, restrictive CORS, JSON limits.
 * T9.1 (Option A): the production client build (client/dist) is served by
 * this same Express process — the SPA's apiClient uses a relative base URL
 * (VITE_API_URL unset → same-origin), so cookies, CORS, and CSP all line up.
 */
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { getEnv } = require('./config/env');
const logger = require('./utils/logger');
const requestId = require('./middleware/requestId');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const syncRoutes = require('./routes/sync.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const reposRoutes = require('./routes/repos.routes');
const timelineRoutes = require('./routes/timeline.routes');
const insightsRoutes = require('./routes/insights.routes');
const webhooksRoutes = require('./routes/webhooks.routes');
require('./models/User');
require('./models/SyncState');
require('./models/SyncJob');
require('./models/Repository');
require('./models/Commit');
require('./models/PullRequest');
require('./models/Issue');
require('./models/LanguageSnapshot');
require('./models/ActivityBucket');
require('./models/Insight');
require('./models/WebhookDelivery');

// T9.1 (Option A): production client build served from this path. Resolved
// against server/src/app.js so it works in the repo AND in the Docker image
// (which copies client/dist to /app/client/dist).
const DEFAULT_CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

/**
 * Whether a usable client build exists at the given dist dir (index.html).
 * @param {string} distDir
 * @returns {boolean}
 */
function hasClientBuild(distDir) {
  return fs.existsSync(path.join(distDir, 'index.html'));
}

/**
 * SPA static + fallback middleware for a built client (T9.1 Option A).
 * Serves hashed assets via express.static and falls back to index.html for
 * any other GET — EXCEPT /api/* (those keep the JSON error envelope). The
 * index.html fallback is deliberately cache-control: no-cache so a redeploy
 * never serves a stale HTML shell.
 * @param {string} distDir
 * @returns {import('express').RequestHandler}
 */
function spaMiddleware(distDir) {
  const staticMiddleware = express.static(distDir, { index: false, maxAge: '1h' });
  const indexPath = path.join(distDir, 'index.html');
  return function spa(req, res, next) {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      return next();
    }
    staticMiddleware(req, res, (err) => {
      if (err) return next(err);
      if (res.headersSent) return;
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexPath);
    });
  };
}

function createApp({ logger: loggerOverride } = {}) {
  const env = getEnv();
  const log = loggerOverride ?? logger;
  const app = express();

  app.disable('x-powered-by');
  // Content-Security-Policy (rules.md §9, architecture.md §13). helmet's
  // defaults give default-src/script-src 'self', object-src 'none', base-uri
  // 'self', form-action 'self', frame-ancestors 'self' (clickjacking), and
  // upgrade-insecure-requests. The overrides tune it to what the Vite-built
  // SPA actually loads (verified against client/dist): one external module
  // script + one external stylesheet (no inline <script>), React inline
  // style="" attributes, GitHub avatars, and same-origin API calls. It is
  // enforced on every Express response, including the SPA once Express serves
  // the client build (tasks.md T9.1 option A); the Vite dev server serves its
  // own HTML on its own origin and is unaffected.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'"],
          'font-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
    })
  );
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
    })
  );
  // Request ID + pino child logger first: EVERY route (including the
  // webhook receiver) must log with reqId (rules.md §13) and req.log must
  // exist in all handlers.
  app.use(requestId);
  app.use((req, _res, next) => {
    // T9.2 (observability): every request-scoped log line carries reqId
    // (rules.md §13). `log` is injectable for tests; production uses the pino
    // singleton. reqId is bound as a child binding, so routes only pass the
    // entry fields — the id is always attached.
    req.log = log.child({ reqId: req.id });
    next();
  });
  // Webhook router runs its own raw-body-preserving JSON parser and must be
  // mounted before the global parser (see webhooks.routes.js RAW-BODY DESIGN).
  app.use('/api/webhooks', webhooksRoutes);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api', dashboardRoutes);
  app.use('/api', reposRoutes);
  app.use('/api', timelineRoutes);
  app.use('/api', insightsRoutes);

  // T9.1 (Option A): serve the production client build when present. Mounted
  // AFTER the API routes so /api/* still resolves to the JSON notFound handler.
  if (hasClientBuild(DEFAULT_CLIENT_DIST)) {
    app.use(spaMiddleware(DEFAULT_CLIENT_DIST));
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, DEFAULT_CLIENT_DIST, hasClientBuild, spaMiddleware };
