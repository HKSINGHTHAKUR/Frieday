/**
 * Repositories routes (T5.1) — list and detail with cursor pagination.
 *
 * GET /api/repos?sort=activity|recent&limit&cursor
 * GET /api/repos/:id?range=90d
 */

const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const { validate } = require('../utils/validation');
const {
  reposListQuerySchema,
  repoDetailParamsSchema,
  repoDetailQuerySchema,
} = require('../utils/validation');
const { listReposHandler, repoDetailHandler } = require('../services/repos/repos.controller');

const router = Router();

router.get('/repos', requireAuth, validate(reposListQuerySchema), listReposHandler);

router.get(
  '/repos/:id',
  requireAuth,
  validate(repoDetailParamsSchema, 'params'),
  validate(repoDetailQuerySchema),
  repoDetailHandler
);

module.exports = router;
