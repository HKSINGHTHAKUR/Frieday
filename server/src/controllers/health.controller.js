/**
 * Health controller (thin: shape response, no logic).
 * Contract: GET /api/health → { ok, version, db, github, uptime }
 */
const { dbStatus } = require('../config/db');
const { configStatus: githubConfigStatus } = require('../config/github');
const serverPkg = require('../../package.json');

const bootTime = Date.now();

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function getHealth(req, res) {
  req.log.debug({ reqId: req.id, msg: 'health check' });
  res.json({
    ok: true,
    version: serverPkg.version,
    db: dbStatus(),
    // Configuration state only — no network call on the health path.
    github: githubConfigStatus(),
    uptime: Math.floor((Date.now() - bootTime) / 1000),
  });
}

module.exports = { getHealth };
