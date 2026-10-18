/**
 * Composer data loading (T4.3)
 */

const Commit = require('../../models/Commit');
const PullRequest = require('../../models/PullRequest');
const Issue = require('../../models/Issue');
const Repository = require('../../models/Repository');
const LanguageSnapshot = require('../../models/LanguageSnapshot');

/**
 * Load all raw records for a user within a date range.
 * Returns commits, PRs, issues, repos, language snapshots within [rangeStart, anchor].
 */
async function loadRawData(userId, range, anchor) {
  const { rangeStart } = require('./timeline');
  const start = rangeStart(range, anchor);
  const end = anchor; // anchor is already day-started

  const [commits, pullRequests, issues, repositories, languageSnapshots] = await Promise.all([
    Commit.find({ userId, authoredAt: { $gte: start, $lte: end } }).lean(),
    PullRequest.find({
      userId,
      $or: [
        { createdAt: { $gte: start, $lte: end } },
        { mergedAt: { $gte: start, $lte: end } },
        { updatedAt: { $gte: start, $lte: end } },
      ],
    }).lean(),
    Issue.find({
      userId,
      $or: [
        { createdAt: { $gte: start, $lte: end } },
        { updatedAt: { $gte: start, $lte: end } },
        { closedAt: { $gte: start, $lte: end } },
      ],
    }).lean(),
    Repository.find({ userId }).lean(),
    // Language snapshots are repository metadata, not activity events.
    // Load all snapshots for the user; computeLanguageAggregation selects the
    // latest per repo. Filtering by fetchedAt range would exclude snapshots
    // fetched after the range end (e.g. today after midnight), causing the
    // dashboard to show "No language data" despite valid snapshots existing.
    LanguageSnapshot.find({ userId }).lean(),
  ]);

  return { commits, pullRequests, issues, repositories, languageSnapshots };
}

module.exports = {
  loadRawData,
};
