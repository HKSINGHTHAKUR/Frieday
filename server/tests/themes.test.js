/**
 * Commit-theme clustering tests (Phase 10.1).
 *
 * Every assertion below encodes the DOCUMENTED behaviour (theme-rules.js
 * header + themes.js module contract), not an implementation detail.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  THEME_RULES_VERSION,
  THEME_OUTPUT_VERSION,
  THEME_NAMES,
  computeThemes,
  classifyHeadline,
  tokenize,
  parseConventionalPrefix,
} = require('../src/services/intelligence/themes');

const {
  THEME_PREFIXES,
  THEME_TOKENS,
  THEME_PRIORITY,
  THEME_CONFIDENCE_THRESHOLDS,
  THEME_EVIDENCE_LIMITS,
} = require('../src/services/intelligence/theme-rules');

const REPOS = [
  { _id: 'r1', fullName: 'me/alpha', owner: 'me', name: 'alpha' },
  { _id: 'r2', fullName: 'me/beta', owner: 'me', name: 'beta' },
];

/** Build n commits with the given headline, spread over the given repo ids. */
function commits(n, headline, repoIds = ['r1'], shaPrefix = 'sha') {
  return Array.from({ length: n }, (_, i) => ({
    sha: `${shaPrefix}${i}`,
    repoId: repoIds[i % repoIds.length],
    messageHeadline: headline,
  }));
}

describe('themes.js (Phase 10.1)', () => {
  describe('version constants', () => {
    it('THEME_RULES_VERSION is 1', () => {
      assert.equal(THEME_RULES_VERSION, 1);
    });

    it('THEME_OUTPUT_VERSION is 1', () => {
      assert.equal(THEME_OUTPUT_VERSION, 1);
    });

    it('the payload reports both versions', () => {
      const out = computeThemes({});
      assert.equal(out.version, THEME_OUTPUT_VERSION);
      assert.equal(out.rulesVersion, THEME_RULES_VERSION);
    });
  });

  describe('taxonomy structure', () => {
    it('exposes the seven documented themes', () => {
      assert.deepEqual([...THEME_NAMES].sort(), [
        'Bug fix',
        'Documentation',
        'Feature',
        'Performance',
        'Refactor',
        'Security',
        'Testing',
      ]);
    });

    it('every theme has a non-empty prefix list and token list', () => {
      for (const theme of THEME_NAMES) {
        assert.ok(Array.isArray(THEME_PREFIXES[theme]), `${theme} must declare prefixes`);
        assert.ok(THEME_PREFIXES[theme].length > 0, `${theme} must declare >=1 prefix`);
        assert.ok(Array.isArray(THEME_TOKENS[theme]), `${theme} must declare tokens`);
        assert.ok(THEME_TOKENS[theme].length > 0, `${theme} must declare >=1 token`);
      }
    });

    it('conventional prefixes are disjoint across themes', () => {
      const seen = new Map();
      for (const [theme, prefixes] of Object.entries(THEME_PREFIXES)) {
        for (const prefix of prefixes) {
          assert.ok(!seen.has(prefix), `prefix "${prefix}" used by both ${seen.get(prefix)} and ${theme}`);
          seen.set(prefix, theme);
        }
      }
    });

    it('tokens are disjoint across themes so priority is unambiguous', () => {
      const seen = new Map();
      for (const theme of THEME_PRIORITY) {
        for (const token of THEME_TOKENS[theme] || []) {
          assert.ok(!seen.has(token), `token "${token}" used by both ${seen.get(token)} and ${theme}`);
          seen.set(token, theme);
        }
      }
    });

    it('priority order covers every theme exactly once', () => {
      assert.equal(THEME_PRIORITY.length, THEME_NAMES.length);
      assert.deepEqual([...THEME_PRIORITY].sort(), [...THEME_NAMES].sort());
    });

    it('confidence thresholds match the established intelligence conventions', () => {
      assert.equal(THEME_CONFIDENCE_THRESHOLDS.HIGH_MIN_COMMITS, 10);
      assert.equal(THEME_CONFIDENCE_THRESHOLDS.HIGH_MIN_REPOS, 2);
      assert.equal(THEME_CONFIDENCE_THRESHOLDS.MEDIUM_MIN_COMMITS, 5);
    });
  });

  describe('tokenize', () => {
    it('splits on non-alphanumeric characters', () => {
      assert.deepEqual(tokenize('fix(api): handle null'), ['fix', 'api', 'handle', 'null']);
    });

    it('lowercases', () => {
      assert.deepEqual(tokenize('FIX Bug'), ['fix', 'bug']);
    });

    it('returns an empty array for non-strings', () => {
      assert.deepEqual(tokenize(null), []);
      assert.deepEqual(tokenize(undefined), []);
      assert.deepEqual(tokenize(''), []);
    });
  });

  describe('parseConventionalPrefix', () => {
    it('parses a bare type prefix', () => {
      assert.equal(parseConventionalPrefix('fix: null deref'), 'fix');
    });

    it('parses a scoped type prefix', () => {
      assert.equal(parseConventionalPrefix('feat(api): add endpoint'), 'feat');
    });

    it('is case-insensitive', () => {
      assert.equal(parseConventionalPrefix('FIX: thing'), 'fix');
    });

    it('returns null without a conventional prefix', () => {
      assert.equal(parseConventionalPrefix('just a message'), null);
    });
  });

  describe('classifyHeadline', () => {
    it('null/empty/whitespace headline → noMessage', () => {
      for (const value of [null, undefined, '', '   ', '\t\n']) {
        const r = classifyHeadline(value);
        assert.equal(r.bucket, 'noMessage', `${JSON.stringify(value)} must be noMessage`);
        assert.equal(r.theme, null);
      }
    });

    it('conventional prefix takes precedence over conflicting keywords', () => {
      // "feat" prefix but the body mentions bug words — the prefix wins.
      const r = classifyHeadline('feat: add fix for broken build');
      assert.equal(r.bucket, 'theme');
      assert.equal(r.theme, 'Feature');
      assert.equal(r.matchedBy, 'prefix');
    });

    it('fix: maps to Bug fix', () => {
      assert.equal(classifyHeadline('fix: null deref').theme, 'Bug fix');
    });

    it('feat: maps to Feature', () => {
      assert.equal(classifyHeadline('feat: add endpoint').theme, 'Feature');
    });

    it('refactor: maps to Refactor', () => {
      assert.equal(classifyHeadline('refactor: extract helper').theme, 'Refactor');
    });

    it('perf: maps to Performance', () => {
      assert.equal(classifyHeadline('perf: speed up query').theme, 'Performance');
    });

    it('test: maps to Testing', () => {
      assert.equal(classifyHeadline('test: add coverage').theme, 'Testing');
    });

    it('docs: maps to Documentation', () => {
      assert.equal(classifyHeadline('docs: update readme').theme, 'Documentation');
    });

    it('does not match fix inside prefix', () => {
      const r = classifyHeadline('update prefix constant');
      assert.notEqual(r.theme, 'Bug fix');
    });

    it('does not match auth inside authentic', () => {
      const r = classifyHeadline('make authentic token better');
      assert.notEqual(r.theme, 'Security');
    });

    it('matches auth as a whole token', () => {
      assert.equal(classifyHeadline('tighten auth flow').theme, 'Security');
    });

    it('does not match fix as a substring of a longer word', () => {
      const r = classifyHeadline('refactor the prefixer');
      assert.notEqual(r.theme, 'Bug fix');
    });

    it('resolves keyword conflicts through the documented priority', () => {
      // "fix" token (Bug fix) and "add" token (Feature) both present.
      // Bug fix outranks Feature in THEME_PRIORITY.
      const r = classifyHeadline('add fix for the parser');
      assert.equal(r.theme, 'Bug fix');
    });

    it('resolves security over feature on keyword-only conflict', () => {
      const r = classifyHeadline('allow oauth token refresh');
      assert.equal(r.theme, 'Security');
    });

    it('unmatched headline → unclassified', () => {
      const r = classifyHeadline('tidy up');
      assert.equal(r.bucket, 'unclassified');
      assert.equal(r.theme, null);
    });

    it('merge noise → noise', () => {
      assert.equal(classifyHeadline('Merge pull request #12 from me/feature').bucket, 'noise');
    });

    it('merge branch noise → noise', () => {
      assert.equal(classifyHeadline('Merge branch main into feature').bucket, 'noise');
    });

    it('wip → noise', () => {
      assert.equal(classifyHeadline('wip').bucket, 'noise');
    });

    it('revert → noise', () => {
      assert.equal(classifyHeadline('revert "feat: x"').bucket, 'noise');
    });

    it('dependency bump → noise', () => {
      assert.equal(classifyHeadline('chore: bump lodash to 4.17.21').bucket, 'noise');
    });

    it('chore prefix → noise', () => {
      assert.equal(classifyHeadline('chore: update lockfile').bucket, 'noise');
    });

    it('build prefix → noise', () => {
      assert.equal(classifyHeadline('build: bump ci runner').bucket, 'noise');
    });
  });

  describe('computeThemes — empty and degenerate input', () => {
    it('empty input returns an empty payload', () => {
      const out = computeThemes({});
      assert.equal(out.totalCommits, 0);
      assert.equal(out.themedCommits, 0);
      assert.equal(out.unclassified, 0);
      assert.equal(out.noMessage, 0);
      assert.equal(out.noise, 0);
      assert.deepEqual(out.items, []);
    });

    it('no commits returns an empty payload', () => {
      const out = computeThemes({ commits: [], repositories: [] });
      assert.deepEqual(out.items, []);
      assert.equal(out.totalCommits, 0);
    });

    it('commits without headlines are all noMessage and produce no themes', () => {
      const out = computeThemes({ commits: commits(3, null) });
      assert.equal(out.totalCommits, 3);
      assert.equal(out.noMessage, 3);
      assert.equal(out.themedCommits, 0);
      assert.deepEqual(out.items, []);
    });
  });

  describe('computeThemes — bucketing and reconciliation', () => {
    it('classifies each commit into exactly one bucket', () => {
      const out = computeThemes({
        commits: [
          { sha: 'a', repoId: 'r1', messageHeadline: 'fix: crash' },
          { sha: 'b', repoId: 'r1', messageHeadline: 'chore: bump deps' },
          { sha: 'c', repoId: 'r1', messageHeadline: 'just some words' },
          { sha: 'd', repoId: 'r1', messageHeadline: null },
        ],
      });
      assert.equal(out.totalCommits, 4);
      assert.equal(out.themedCommits, 1);
      assert.equal(out.noise, 1);
      assert.equal(out.unclassified, 1);
      assert.equal(out.noMessage, 1);
    });

    it('counts always reconcile: total = themed + unclassified + noMessage + noise', () => {
      const out = computeThemes({
        commits: [
          { sha: 'a', repoId: 'r1', messageHeadline: 'fix: crash' },
          { sha: 'b', repoId: 'r1', messageHeadline: 'chore: bump deps' },
          { sha: 'c', repoId: 'r1', messageHeadline: 'just some words' },
          { sha: 'd', repoId: 'r1', messageHeadline: null },
          { sha: 'e', repoId: 'r2', messageHeadline: 'feat: add thing' },
        ],
      });
      assert.equal(out.totalCommits, out.themedCommits + out.unclassified + out.noMessage + out.noise);
    });

    it('a commit belongs to at most one theme', () => {
      const out = computeThemes({
        commits: [{ sha: 'a', repoId: 'r1', messageHeadline: 'fix: add feature and auth' }],
      });
      assert.equal(out.items.length, 1);
      assert.equal(out.themedCommits, 1);
    });
  });

  describe('computeThemes — all seven theme categories', () => {
    const cases = [
      ['Bug fix', 'fix: crash in parser'],
      ['Security', 'sanitize oauth token'],
      ['Performance', 'optimize slow query'],
      ['Testing', 'add unit coverage'],
      ['Documentation', 'update readme typos'],
      ['Refactor', 'extract helper function'],
      ['Feature', 'add new endpoint'],
    ];

    for (const [theme, headline] of cases) {
      it(`classifies "${headline}" as ${theme}`, () => {
        const out = computeThemes({ commits: commits(1, headline) });
        assert.equal(out.items.length, 1);
        assert.equal(out.items[0].theme, theme);
        assert.equal(out.items[0].commitCount, 1);
      });
    }
  });

  describe('computeThemes — confidence thresholds', () => {
    it('4 commits in one repo → Low', () => {
      const out = computeThemes({ commits: commits(4, 'fix: crash', ['r1']), repositories: REPOS });
      assert.equal(out.items[0].confidence, 'Low');
    });

    it('5 commits in one repo → Medium', () => {
      const out = computeThemes({ commits: commits(5, 'fix: crash', ['r1']), repositories: REPOS });
      assert.equal(out.items[0].confidence, 'Medium');
    });

    it('10 commits in one repo → Medium (needs 2 repos for High)', () => {
      const out = computeThemes({ commits: commits(10, 'fix: crash', ['r1']), repositories: REPOS });
      assert.equal(out.items[0].confidence, 'Medium');
    });

    it('10 commits across 2 repos → High', () => {
      const out = computeThemes({
        commits: commits(10, 'fix: crash', ['r1', 'r2']),
        repositories: REPOS,
      });
      assert.equal(out.items[0].confidence, 'High');
    });
  });

  describe('computeThemes — percentage denominator', () => {
    it('share is computed over themed commits only', () => {
      const out = computeThemes({
        commits: [
          ...commits(3, 'fix: crash', ['r1'], 'a'),
          ...commits(1, 'feat: add thing', ['r1'], 'b'),
          { sha: 'c', repoId: 'r1', messageHeadline: 'chore: bump' },
          { sha: 'd', repoId: 'r1', messageHeadline: null },
        ],
      });
      assert.equal(out.themedCommits, 4);
      const fix = out.items.find((i) => i.theme === 'Bug fix');
      const feat = out.items.find((i) => i.theme === 'Feature');
      assert.equal(fix.share, 0.75);
      assert.equal(feat.share, 0.25);
      const total = out.items.reduce((sum, i) => sum + i.share, 0);
      assert.ok(Math.abs(total - 1) < 0.001, 'theme shares must sum to 1');
    });

    it('no themed commits yields no items and zero shares', () => {
      const out = computeThemes({ commits: commits(3, null) });
      assert.equal(out.themedCommits, 0);
      assert.deepEqual(out.items, []);
    });
  });

  describe('computeThemes — evidence bounds', () => {
    it('commitShas are bounded', () => {
      const out = computeThemes({ commits: commits(30, 'fix: crash') });
      assert.equal(out.items[0].evidence.commitShas.length, THEME_EVIDENCE_LIMITS.MAX_COMMIT_SHAS);
    });

    it('sampleMessages are bounded to 5', () => {
      const out = computeThemes({ commits: commits(30, 'fix: crash') });
      assert.equal(out.items[0].evidence.sampleMessages.length, THEME_EVIDENCE_LIMITS.MAX_SAMPLE_MESSAGES);
    });

    it('never exposes the commit body', () => {
      const out = computeThemes({
        commits: [{ sha: 'a', repoId: 'r1', messageHeadline: 'fix: crash', messageFull: 'SECRET BODY TEXT' }],
      });
      assert.ok(!JSON.stringify(out).includes('SECRET BODY TEXT'));
    });

    it('sample messages are trimmed headlines', () => {
      const out = computeThemes({
        commits: [{ sha: 'a', repoId: 'r1', messageHeadline: '  fix: crash  ' }],
      });
      assert.deepEqual(out.items[0].evidence.sampleMessages, ['fix: crash']);
    });

    it('contributing repositories are reported by name', () => {
      const out = computeThemes({
        commits: commits(2, 'fix: crash', ['r1', 'r2']),
        repositories: REPOS,
      });
      assert.deepEqual(out.items[0].evidence.repoNames.sort(), ['me/alpha', 'me/beta']);
    });
  });

  describe('computeThemes — determinism and purity', () => {
    it('same input produces identical output', () => {
      const input = {
        commits: commits(12, 'fix: crash', ['r1', 'r2']),
        repositories: REPOS,
      };
      const a = computeThemes(input);
      const b = computeThemes(input);
      assert.deepEqual(a, b);
    });

    it('input order does not affect the result', () => {
      const docs = [...commits(6, 'fix: crash', ['r1'], 'a'), ...commits(4, 'feat: add thing', ['r2'], 'b')];
      const forward = computeThemes({ commits: docs, repositories: REPOS });
      const reversed = computeThemes({ commits: [...docs].reverse(), repositories: REPOS });
      assert.deepEqual(forward, reversed);
    });

    it('does not mutate the input commits', () => {
      const docs = commits(3, 'fix: crash');
      const snapshot = JSON.stringify(docs);
      computeThemes({ commits: docs, repositories: REPOS });
      assert.equal(JSON.stringify(docs), snapshot);
    });
  });

  describe('computeThemes — long / truncated headlines', () => {
    it('classifies a headline truncated at 120 characters', () => {
      const long = `fix: ${'x'.repeat(200)}`;
      const truncated = long.slice(0, 120);
      const out = computeThemes({ commits: [{ sha: 'a', repoId: 'r1', messageHeadline: truncated }] });
      assert.equal(out.items[0].theme, 'Bug fix');
    });

    it('a keyword split by truncation is not matched (documented limitation)', () => {
      // "securi" is the truncated form of "security" — it must NOT classify.
      // The headline deliberately contains no other theme token.
      const out = computeThemes({
        commits: [{ sha: 'a', repoId: 'r1', messageHeadline: 'tweak the file to securi' }],
      });
      assert.equal(out.themedCommits, 0);
      assert.equal(out.unclassified, 1);
    });
  });

  describe('computeThemes — no default theme when nothing qualifies', () => {
    it('never invents a theme', () => {
      const out = computeThemes({ commits: commits(50, 'some random words here') });
      assert.deepEqual(out.items, []);
      assert.equal(out.unclassified, 50);
    });
  });
});
