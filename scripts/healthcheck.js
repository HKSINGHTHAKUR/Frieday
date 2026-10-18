/**
 * Frieday health check for host/container monitors (T9.2).
 *
 * Hits GET /api/health and exits 0 when the service is up, 1 otherwise.
 * Use it for the non-Docker path (systemd, cron, monitoring agents) — the
 * Docker image already ships an equivalent HEALTHCHECK (Dockerfile T9.1).
 *
 * Uses the built-in http(s) module (not fetch) so the request handle is fully
 * closed before process.exit() — deterministic on every platform.
 *
 * Usage:
 *   node scripts/healthcheck.js [baseUrl]
 *   baseUrl defaults to process.env.PROD_URL || http://127.0.0.1:5000
 *
 * Optionally require the database to be reachable:
 *   CHECK_DB=true node scripts/healthcheck.js https://frieday.example.com
 *
 * Exit code: 0 = healthy, 1 = unhealthy. Never prints secrets.
 */
const http = require('node:http');
const https = require('node:https');

const BASE = process.argv[2] || process.env.PROD_URL || 'http://127.0.0.1:5000';
const REQUIRE_DB = String(process.env.CHECK_DB) === 'true';
const TIMEOUT_MS = 5000;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(data);
        } catch {
          body = null;
        }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`)));
  });
}

async function check() {
  const { status, body } = await getJson(new URL(`${BASE}/api/health`));
  if (status !== 200 || !body || body.ok !== true) return false;
  if (REQUIRE_DB && body.db !== 'up') return false;
  return true;
}

check()
  .then((ok) => {
    console.log(`healthcheck ${ok ? 'UP' : 'DOWN'} — ${BASE}`);
    process.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    console.log(`healthcheck DOWN — ${BASE} (${err.message})`);
    process.exit(1);
  });
