/**
 * Cursor pagination utility (T5.1) — opaque, deterministic cursor encoding.
 *
 * Cursor format: base64(JSON) where JSON = { afterId: string, afterCreatedAt: string }
 * Both fields are required for deterministic pagination with consistent ordering.
 *
 * Pure: no I/O, no side effects.
 */

const mongoose = require('mongoose');

/**
 * Encode a cursor for the next page.
 * @param {Object} opts
 * @param {string} opts.afterId - ObjectId of the last item on current page
 * @param {string} opts.afterCreatedAt - ISO timestamp of the last item
 * @returns {string} base64-encoded cursor
 */
function encodeCursor({ afterId, afterCreatedAt }) {
  const payload = { afterId, afterCreatedAt };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decode and validate a cursor.
 * @param {string} cursor - base64-encoded cursor
 * @returns {Object|null} { afterId, afterCreatedAt } or null if invalid
 */
function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;

  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);

    if (!parsed || typeof parsed.afterId !== 'string' || typeof parsed.afterCreatedAt !== 'string') {
      return null;
    }

    // Validate ObjectId format (24 hex chars)
    if (!/^[0-9a-fA-F]{24}$/.test(parsed.afterId)) {
      return null;
    }

    // Validate ISO timestamp
    const date = new Date(parsed.afterCreatedAt);
    if (isNaN(date.getTime())) {
      return null;
    }

    return { afterId: parsed.afterId, afterCreatedAt: parsed.afterCreatedAt };
  } catch {
    return null;
  }
}

/**
 * Build a MongoDB query filter for cursor-based pagination.
 * Assumes sorting by createdAt descending, then _id descending.
 *
 * @param {Object|null} cursor - decoded cursor or null
 * @returns {Object} MongoDB query filter
 */
function buildCursorFilter(cursor) {
  if (!cursor) return {};

  const { afterId, afterCreatedAt } = cursor;

  // For descending sort: items after cursor must be "older"
  // createdAt < cursor.afterCreatedAt OR (createdAt == cursor.afterCreatedAt AND _id < cursor.afterId)
  return {
    $or: [
      { createdAt: { $lt: new Date(afterCreatedAt) } },
      {
        createdAt: new Date(afterCreatedAt),
        _id: { $lt: new mongoose.Types.ObjectId(afterId) },
      },
    ],
  };
}

/**
 * Build sort object for consistent ordering.
 * @param {string} sortField - field to sort by (default: 'createdAt')
 * @param {number} direction - 1 for ascending, -1 for descending
 * @returns {Object} MongoDB sort object
 */
function buildSort({ sortField = 'createdAt', direction = -1 } = {}) {
  return { [sortField]: direction, _id: direction };
}

module.exports = {
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
  buildSort,
};
