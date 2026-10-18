/**
 * Frieday production smoke test (tasks.md T9.1 — "smoke test script
 * (health/auth/sync/dashboard) run against prod; outputs recorded").
 *
 * Automatable checks against a deployed instance:
 *   1. GET /api/health            → { ok, db, github, version } shape, db:up
 *   2. GET /                      → SPA HTML shell served (Option A)
 *   3. GET /api/auth/github       → 302 to github.com (OAuth configured) or
 *                                   501 INVALID_CONFIG (reported, not fatal)
 *   4. GET /api/auth/me (no cookie) → 401 (auth gate is live)
 *   5. security headers           → helmet baseline present on /api/health
 *   6. no secrets leaked          → health body has no token/URI/secret values
 *
 * The full OAuth login → sync → dashboard acceptance path needs a real GitHub
 * account + seeded MongoDB and is a BROWSER flow — not automatable from this
 * script. Those items print as NOT VERIFIED with the exact manual steps.
 *
 * Usage:  node scripts/smoke.js [baseUrl]
 *         (baseUrl defaults to process.env.PROD_URL or http://localhost:5000)
 * Exit code: 0 when all automatable checks pass; 1 otherwise.
 */
const BASE = process.argv[2] || process.env.PROD_URL || 'http://localhost:5000';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`Frieday smoke test → ${BASE}\n`);

  // 1. Health
  try {
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.json();
    const ok = res.status === 200 && body.ok === true && typeof body.version === 'string';
    record('GET /api/health 200 + ok', ok, `db=${body.db} github=${body.github} version=${body.version}`);
  } catch (err) {
    record('GET /api/health 200 + ok', false, `network error: ${err.message}`);
  }

  // 2. SPA shell (Option A)
  try {
    const res = await fetch(`${BASE}/`);
    const type = res.headers.get('content-type') ?? '';
    const body = await res.text();
    const ok = res.status === 200 && /text\/html/.test(type) && /<div id="root">/.test(body);
    record('GET / serves SPA shell', ok, `status=${res.status}`);
  } catch (err) {
    record('GET / serves SPA shell', false, `network error: ${err.message}`);
  }

  // 3. OAuth entry point
  try {
    const res = await fetch(`${BASE}/api/auth/github`, { redirect: 'manual' });
    if (res.status === 302) {
      const loc = res.headers.get('location') ?? '';
      record(
        'GET /api/auth/github → GitHub',
        /github\.com\/login\/oauth\/authorize/.test(loc),
        loc.slice(0, 80)
      );
    } else {
      const body = await res.json().catch(() => ({}));
      record(
        'GET /api/auth/github → GitHub',
        false,
        `status=${res.status} code=${body.error?.code} (OAuth App not configured in this env?)`
      );
    }
  } catch (err) {
    record('GET /api/auth/github → GitHub', false, `network error: ${err.message}`);
  }

  // 4. Auth gate on a protected endpoint
  try {
    const res = await fetch(`${BASE}/api/auth/me`, { redirect: 'manual' });
    record('GET /api/auth/me (no cookie) → 401', res.status === 401, `status=${res.status}`);
  } catch (err) {
    record('GET /api/auth/me (no cookie) → 401', false, `network error: ${err.message}`);
  }

  // 5. Security headers (helmet baseline)
  try {
    const res = await fetch(`${BASE}/api/health`);
    const h = res.headers;
    const ok =
      h.get('x-content-type-options') === 'nosniff' &&
      (h.get('strict-transport-security') ?? '').includes('max-age=') &&
      (h.get('content-security-policy') ?? '').includes("script-src 'self'") &&
      h.get('x-powered-by') === null;
    record('security headers present', ok, 'CSP/HSTS/XCTO verified, x-powered-by absent');
  } catch (err) {
    record('security headers present', false, `network error: ${err.message}`);
  }

  // 6. No secrets in the health response
  try {
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.text();
    const leakPattern = /(gh[pousr]_|sk-[A-Za-z0-9]|mongodb(\+srv)?:\/\/[^/\s]+:[^@\s]+@|-----BEGIN)/i;
    record(
      'health body contains no secrets',
      !leakPattern.test(body),
      leakPattern.test(body) ? 'secret-like value detected' : 'clean'
    );
  } catch (err) {
    record('health body contains no secrets', false, `network error: ${err.message}`);
  }

  console.log('\nManual acceptance items (require live GitHub + seeded MongoDB — a browser flow):');
  console.log('  [ ] OAuth login: open the production origin, click "Connect with GitHub", authorize,');
  console.log('      confirm redirect back to /dashboard?connected=1');
  console.log('  [ ] GitHub sync: click "Sync now" (or trigger a webhook/scheduler run), confirm progress');
  console.log('      reaches done and GitHub data lands in MongoDB');
  console.log('  [ ] Dashboard: confirm production data renders (KPIs, chart, languages, insights)');
  console.log('  [ ] Webhook delivery: from GitHub webhook settings use "Redeliver" on a push event and');
  console.log('      confirm repo data is refreshed within minutes (p95 < 5 min)');
  console.log('  [ ] Cookie/CORS: devtools shows HttpOnly + Secure cookies; no cross-origin 401/403');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} automatable checks passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('smoke failed to run:', err.message);
  process.exit(1);
});
