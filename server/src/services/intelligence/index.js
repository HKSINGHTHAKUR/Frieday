/**
 * Intelligence engine (Phase 4) — deterministic analytics entry point.
 *
 * Exports pure functions for timeline, languages, focus, consistency,
 * deltas, repoHealth, insights, and the composer.
 *
 * No I/O, no DB access, no network calls, no wall-clock.
 * All functions accept explicit inputs and return deterministic outputs.
 */

const timeline = require('./timeline');
const languages = require('./languages');
const focus = require('./focus');
const consistency = require('./consistency');
const deltas = require('./deltas');
const repoHealth = require('./repoHealth');
const insights = require('./insights');
const composer = require('./composer');

module.exports = {
  timeline,
  languages,
  focus,
  consistency,
  deltas,
  repoHealth,
  insights,
  composer,
};
