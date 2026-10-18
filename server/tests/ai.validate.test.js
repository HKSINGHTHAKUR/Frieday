/**
 * AI output validator tests (T6.1) — allowlist pass + adversarial rejects.
 * The validator is the gate before any AI output reaches callers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateAiOutput,
  numericTokens,
  repoTokens,
  countWords,
  REASONS,
} = require('../src/services/ai/validate');

const INPUT = {
  insightTemplateId: 'ACTIVITY_MOMENTUM',
  insightText: 'Commits are up 12% versus the prior period (45 versus 40).',
  metrics: { changePercent: 12.5, currentCommits: 45, priorCommits: 40 },
  evidenceSummary: {
    repoIds: ['64b64b64b64b64b64b64b64b'],
    bucketStarts: ['2026-09-01T00:00:00Z'],
    counts: { repos: 1, commits: 45, pullRequests: 2, buckets: 30 },
  },
  timeRange: '30d',
};

function validOutput(overrides = {}) {
  return {
    paraphrase: 'Your commits rose 12% versus the prior period.',
    whyItMatters: 'Consistent commit growth signals steady activity.',
    ...overrides,
  };
}

describe('ai/validate.js (T6.1)', () => {
  describe('helpers', () => {
    it('counts words deterministically', () => {
      assert.equal(countWords('one two  three\nfour'), 4);
      assert.equal(countWords('  '), 0);
    });

    it('extracts numeric tokens including comma and decimal forms', () => {
      const tokens = numericTokens('up 12.5% (1,200 commits) over 45/120 days');
      assert.ok(tokens.has('12.5'));
      assert.ok(tokens.has('1200'));
      assert.ok(tokens.has('45'));
      assert.ok(tokens.has('120'));
    });

    it('extracts owner/name repository tokens, lowercased', () => {
      const tokens = repoTokens('Work in Tester/App and org/lib, not in plain text');
      assert.ok(tokens.has('tester/app'));
      assert.ok(tokens.has('org/lib'));
    });
  });

  describe('accepts valid output', () => {
    it('accepts a contract-compliant response', () => {
      const result = validateAiOutput(validOutput(), INPUT);
      assert.equal(result.ok, true);
      assert.equal(result.value.paraphrase, validOutput().paraphrase);
      assert.equal(result.value.whyItMatters, 'Consistent commit growth signals steady activity.');
    });

    it('accepts output without whyItMatters', () => {
      const result = validateAiOutput({ paraphrase: 'Commits are up 12% versus the prior period.' }, INPUT);
      assert.equal(result.ok, true);
      assert.equal(result.value.whyItMatters, undefined);
    });

    it('accepts numbers that appear anywhere in the supplied input', () => {
      const result = validateAiOutput(
        { paraphrase: '45 commits across 1 repo in the last 30d, up 12.5% versus 40.' },
        INPUT
      );
      assert.equal(result.ok, true);
    });

    it('accepts repository tokens present in the input', () => {
      const input = { ...INPUT, insightText: 'Activity in tester/app rose 12%.' };
      const result = validateAiOutput({ paraphrase: 'tester/app activity rose 12%.' }, input);
      assert.equal(result.ok, true);
    });
  });

  describe('rejects invalid output', () => {
    it('rejects missing/invalid paraphrase', () => {
      assert.equal(validateAiOutput({}, INPUT).reason, REASONS.BAD_SHAPE);
      assert.equal(validateAiOutput({ paraphrase: '   ' }, INPUT).reason, REASONS.BAD_SHAPE);
      assert.equal(validateAiOutput('a string', INPUT).reason, REASONS.BAD_SHAPE);
      assert.equal(validateAiOutput({ paraphrase: 'ok', whyItMatters: 5 }, INPUT).reason, REASONS.BAD_SHAPE);
    });

    it('rejects a paraphrase over 80 words', () => {
      const long = Array.from({ length: 81 }, (_, i) => `word${i}`).join(' ');
      const result = validateAiOutput({ paraphrase: long }, INPUT);
      assert.equal(result.reason, REASONS.TOO_LONG);
      assert.match(result.detail, /80 words/);
    });

    it('rejects whyItMatters over 30 words', () => {
      const long = Array.from({ length: 31 }, (_, i) => `word${i}`).join(' ');
      const result = validateAiOutput(validOutput({ whyItMatters: long }), INPUT);
      assert.equal(result.reason, REASONS.TOO_LONG);
      assert.match(result.detail, /30 words/);
    });

    it('rejects a numeric value that is not in the input', () => {
      const result = validateAiOutput({ paraphrase: 'Commits are up 99% versus the prior period.' }, INPUT);
      assert.equal(result.reason, REASONS.NEW_NUMBER);
      assert.match(result.detail, /99/);
    });

    it('rejects a repository name that is not in the input', () => {
      const result = validateAiOutput(
        { paraphrase: 'Activity in someone-else/unknown-repo rose 12%.' },
        INPUT
      );
      assert.equal(result.reason, REASONS.UNKNOWN_REPO);
      assert.match(result.detail, /unknown-repo/);
    });

    it('rejects expertise/mastery claims', () => {
      const cases = [
        'You are an expert backend engineer.',
        'Your mastery of TypeScript is notable.',
        'You mastered the API surface.',
        'You are in the top 1% of developers.',
        'You are the best developer on the team.',
        'Senior-level design throughout.',
        'Guaranteed promotion material.',
        'Your skill level is elite.',
      ];
      for (const paraphrase of cases) {
        const result = validateAiOutput({ paraphrase }, INPUT);
        assert.equal(result.reason, REASONS.UNSUPPORTED_CLAIM, paraphrase);
      }
    });

    it('rejects unsafe claims appearing only in whyItMatters', () => {
      const result = validateAiOutput(validOutput({ whyItMatters: 'This proves you are an expert.' }), INPUT);
      assert.equal(result.reason, REASONS.UNSUPPORTED_CLAIM);
    });
  });
});
