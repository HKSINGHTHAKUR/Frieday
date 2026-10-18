/**
 * Zod validation schemas (T5.1) — shared validation for all T5.1 endpoints.
 *
 * Pure: no I/O, no side effects.
 */

const { z } = require('zod');

/**
 * Allowed range values per API contract.
 */
const RANGE_VALUES = ['30d', '90d', '12m'];

/**
 * Allowed sort values for repository listing.
 */
const REPO_SORT_VALUES = ['activity', 'recent'];

/**
 * Dashboard query schema.
 */
const dashboardQuerySchema = z.object({
  range: z.enum(RANGE_VALUES, {
    errorMap: () => ({ message: 'Range must be one of: 30d, 90d, 12m' }),
  }),
});

/**
 * Repositories list query schema.
 */
const reposListQuerySchema = z.object({
  sort: z
    .enum(REPO_SORT_VALUES, {
      errorMap: () => ({ message: 'Sort must be one of: activity, recent' }),
    })
    .optional()
    .default('activity'),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().optional(),
});

/**
 * Repository detail params schema.
 */
const repoDetailParamsSchema = z.object({
  id: z.string().min(1, 'Repository ID is required'),
});

/**
 * Repository detail query schema.
 */
const repoDetailQuerySchema = z.object({
  range: z
    .enum(RANGE_VALUES, {
      errorMap: () => ({ message: 'Range must be one of: 30d, 90d, 12m' }),
    })
    .optional()
    .default('90d'),
});

/**
 * Mongo ObjectId shape (24 hex chars) — query-level validation so malformed
 * ids fail validation (400) instead of reaching ObjectId conversion.
 */
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Timeline query schema.
 * `repoId` must be a Mongo ObjectId (24 hex chars) so a malformed value is
 * rejected by validation (400) instead of reaching ObjectId conversion,
 * which would surface as a 500 (BSONError/CastError).
 */
const timelineQuerySchema = z.object({
  range: z.enum(RANGE_VALUES, {
    errorMap: () => ({ message: 'Range must be one of: 30d, 90d, 12m' }),
  }),
  repoId: z.string().regex(OBJECT_ID_PATTERN, 'repoId must be a 24-character hex id').optional(),
  granularity: z
    .enum(['day', 'week'], {
      errorMap: () => ({ message: 'Granularity must be one of: day, week' }),
    })
    .optional(),
});

/**
 * Insights query schema.
 */
const insightsQuerySchema = z.object({
  range: z.enum(RANGE_VALUES, {
    errorMap: () => ({ message: 'Range must be one of: 30d, 90d, 12m' }),
  }),
});

/**
 * Validation middleware factory.
 * Validates query/params/body against a Zod schema.
 * Returns 400 VALIDATION_ERROR on failure.
 */
function validate(schema, source = 'query') {
  return (req, res, next) => {
    const data = req[source];
    const result = schema.safeParse(data);
    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters.',
          details,
          retryable: false,
        },
      });
    }
    // Replace with parsed/coerced values
    req[source] = result.data;
    next();
  };
}

module.exports = {
  RANGE_VALUES,
  REPO_SORT_VALUES,
  dashboardQuerySchema,
  reposListQuerySchema,
  repoDetailParamsSchema,
  repoDetailQuerySchema,
  timelineQuerySchema,
  insightsQuerySchema,
  validate,
};
