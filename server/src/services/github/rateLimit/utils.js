/**
 * Small utility helpers for rate-limit parsing.
 */

function toInt(value) {
  if (value === undefined || value === null) return null;
  const n = Number(String(value).trim());
  return Number.isInteger(n) ? n : null;
}

module.exports = { toInt };
