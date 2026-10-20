/**
 * Commit-theme rules v1 (Phase 10.1) — deterministic conventional-prefix and
 * exact-token mappings.
 *
 * Design constraints (prd.md §2 "never invents", rules.md §24):
 *   - Transparent: every theme is a literal, auditable rule set. No fuzzy
 *     matching, no stemming, no inferred intent.
 *   - Exact token matching only. `fix` never matches inside `prefix`;
 *     `auth` never matches inside `authentic`.
 *   - A conventional-commit prefix (`fix:`, `feat:`, …) takes precedence over
 *     keyword tokens found in the same message, because the prefix is the
 *     author's own explicit type declaration.
 *   - When several keyword themes match, the documented `priority` order
 *     resolves the conflict deterministically (most specific first).
 *   - A commit receives AT MOST ONE theme. Multi-theme commits exist, but
 *     a single label is the honest summary of one commit.
 *
 * Version: THEME_RULES_VERSION = 1. Bump on ANY change to the taxonomy or
 * matching behaviour (mirrors FOCUS_RULES_VERSION / LANGUAGE_OUTPUT_VERSION).
 */

/**
 * Conventional-commit prefixes mapped to a theme. Explicit and disjoint: a
 * prefix may appear in at most one theme's list, so prefix matching is
 * unambiguous.
 */
const THEME_PREFIXES = {
  'Bug fix': ['fix', 'fixes', 'hotfix', 'bugfix'],
  Security: ['security', 'sec'],
  Performance: ['perf', 'performance'],
  Testing: ['test', 'tests', 'e2e'],
  Documentation: ['docs', 'doc', 'documentation'],
  Refactor: ['refactor', 'refactoring'],
  Feature: ['feat', 'feature'],
};

/**
 * Prefix types that indicate maintenance/noise rather than substantive work.
 * Counted separately and never presented as a theme.
 */
const MAINTENANCE_PREFIXES = [
  'chore',
  'build',
  'ci',
  'deps',
  'style',
  'revert',
  'wip',
  'bump',
  'release',
  'merge',
  'types',
];

/**
 * Exact lowercase tokens per theme. These are matched as whole tokens only
 * (split on non-alphanumeric characters), so `prefix`/`authentication` never
 * match `fix`/`auth`.
 */
const THEME_TOKENS = {
  'Bug fix': [
    'bug',
    'bugfix',
    'fix',
    'fixes',
    'defect',
    'regression',
    'crash',
    'broken',
    'incorrect',
    'fails',
    'failure',
    'patch',
  ],
  Security: [
    'security',
    'vulnerability',
    'vuln',
    'cve',
    'xss',
    'csrf',
    'injection',
    'sanitize',
    'sanitise',
    'encrypt',
    'decrypt',
    'auth',
    'authentication',
    'authorization',
    'authorisation',
    'oauth',
    'jwt',
    'permission',
    'permissions',
    'credential',
    'credentials',
    'secret',
    'secrets',
    'password',
    'harden',
  ],
  Performance: [
    'performance',
    'optimize',
    'optimise',
    'optimization',
    'optimisation',
    'speedup',
    'faster',
    'latency',
    'throughput',
    'bottleneck',
    'profiling',
  ],
  Testing: ['test', 'tests', 'testing', 'spec', 'coverage', 'e2e', 'fixture', 'mock', 'assertion'],
  Documentation: [
    'docs',
    'doc',
    'documentation',
    'readme',
    'changelog',
    'comment',
    'comments',
    'typo',
    'guide',
    'tutorial',
  ],
  Refactor: [
    'refactor',
    'refactoring',
    'cleanup',
    'restructure',
    'reorganize',
    'reorganise',
    'simplify',
    'extract',
    'rename',
    'dedupe',
  ],
  Feature: [
    'feature',
    'implement',
    'introduce',
    'support',
    'enhance',
    'improve',
    'enable',
    'allow',
    'create',
    'add',
  ],
};

/**
 * Documented conflict-resolution order. The first theme in this list that
 * matches a token wins. Ordered most-specific-first: a commit that says
 * "fix: sanitize oauth token" is a Bug fix (prefix), and a commit that says
 * "sanitize oauth token" is a Security change (Security outranks the
 * generic Feature token "add").
 */
const THEME_PRIORITY = [
  'Bug fix',
  'Security',
  'Performance',
  'Testing',
  'Documentation',
  'Refactor',
  'Feature',
];

/**
 * Exact lowercase tokens that mark a message as maintenance/noise. Matched
 * as whole tokens. These are reported as a count only — never as a theme.
 */
const NOISE_TOKENS = [
  'wip',
  'merge',
  'merged',
  'revert',
  'reverted',
  'bump',
  'lockfile',
  'lockfiles',
  'vendor',
  'vendored',
  'regenerate',
  'generated',
  'formatting',
  'prettier',
  'eslint',
];

/**
 * Phrases that mark a message as maintenance/noise. Matched against the
 * lowercased headline as a whole phrase (not a token) so they can include
 * spaces.
 */
const NOISE_PHRASES = [
  'merge branch',
  'merge pull request',
  'merge remote-tracking',
  'update lock',
  'bump version',
  'initial commit',
  'squash merge',
  'fixup!',
  'amend',
  'revert "',
];

/**
 * Confidence thresholds, aligned with the established intelligence
 * conventions in focus.js / insights-core.js (High >= 10 commits AND >= 2
 * repos; Medium >= 5 commits; otherwise Low).
 */
const THEME_CONFIDENCE_THRESHOLDS = {
  HIGH_MIN_COMMITS: 10,
  HIGH_MIN_REPOS: 2,
  MEDIUM_MIN_COMMITS: 5,
};

/**
 * Bounded evidence limits so a theme payload can never grow with the size
 * of the dataset (prd.md §19: bounded, safe surfaces).
 */
const THEME_EVIDENCE_LIMITS = {
  MAX_COMMIT_SHAS: 20,
  MAX_SAMPLE_MESSAGES: 5,
  MAX_REPO_NAMES: 10,
};

module.exports = {
  THEME_PREFIXES,
  MAINTENANCE_PREFIXES,
  THEME_TOKENS,
  THEME_PRIORITY,
  NOISE_TOKENS,
  NOISE_PHRASES,
  THEME_CONFIDENCE_THRESHOLDS,
  THEME_EVIDENCE_LIMITS,
};
