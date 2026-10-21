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
  compareThemeItems,
  computeThemes,
  computeRepoThemes,
  computeRepoThemesMap,
  pickTopTheme,
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
  describe('computeRepoThemes — per-repository breakdown (Phase 10.2)', () => {
    it('analyses only the commits of the requested repository', () => {
      const all = [
        { sha: 'a1', repoId: 'r1', messageHeadline: 'fix: crash in parser' },
        { sha: 'a2', repoId: 'r1', messageHeadline: 'fix: another crash' },
        { sha: 'b1', repoId: 'r2', messageHeadline: 'feat: other repo work' },
      ];
      const out = computeRepoThemes({ commits: all, repositories: REPOS, repoId: 'r1' });

      assert.equal(out.totalCommits, 2, 'only r1 commits are counted');
      assert.equal(out.themedCommits, 2);
      assert.equal(out.items.length, 1);
      assert.equal(out.items[0].theme, 'Bug fix');
      assert.equal(out.items[0].commitCount, 2);
      // The other repository must not appear anywhere.
      assert.ok(!JSON.stringify(out).includes('other repo work'));
      assert.ok(!JSON.stringify(out).includes('me/beta'));
    });

    it('uses the per-repo themed-commit denominator', () => {
      const all = [
        { sha: 'a1', repoId: 'r1', messageHeadline: 'fix: crash' },
        { sha: 'a2', repoId: 'r1', messageHeadline: 'feat: add thing' },
        { sha: 'a3', repoId: 'r1', messageHeadline: 'chore: bump deps' },
      ];
      const out = computeRepoThemes({ commits: all, repositories: REPOS, repoId: 'r1' });

      assert.equal(out.themedCommits, 2, 'denominator counts themed commits only');
      assert.equal(out.noise, 1);
      const fix = out.items.find((i) => i.theme === 'Bug fix');
      const feat = out.items.find((i) => i.theme === 'Feature');
      assert.equal(fix.share, 0.5);
      assert.equal(feat.share, 0.5);
      const total = out.items.reduce((sum, i) => sum + i.share, 0);
      assert.ok(Math.abs(total - 1) < 0.001, 'shares must sum to 1');
    });

    it('reconciles counts per repository', () => {
      const all = [
        { sha: 'a1', repoId: 'r1', messageHeadline: 'fix: crash' },
        { sha: 'a2', repoId: 'r1', messageHeadline: 'chore: bump' },
        { sha: 'a3', repoId: 'r1', messageHeadline: null },
        { sha: 'a4', repoId: 'r1', messageHeadline: 'random text here' },
      ];
      const out = computeRepoThemes({ commits: all, repositories: REPOS, repoId: 'r1' });
      assert.equal(out.totalCommits, out.themedCommits + out.unclassified + out.noMessage + out.noise);
      assert.equal(out.totalCommits, 4);
    });

    it('an empty repository yields an empty payload, never a fabricated theme', () => {
      const out = computeRepoThemes({ commits: [], repositories: REPOS, repoId: 'r1' });
      assert.equal(out.totalCommits, 0);
      assert.equal(out.themedCommits, 0);
      assert.deepEqual(out.items, []);
      assert.equal(out.topTheme, null);
    });

    it('a missing repoId yields an empty payload', () => {
      const out = computeRepoThemes({ commits: commits(3, 'fix: crash'), repositories: REPOS });
      assert.equal(out.totalCommits, 0);
      assert.deepEqual(out.items, []);
    });

    it('per-repo confidence does not borrow the cross-repo 2-repository tier', () => {
      // 10 commits in ONE repo: the cross-repo scope would be Medium (needs
      // >=2 repos for High); the per-repo scope reaches High on commit count
      // alone, because a single repository cannot corroborate across repos.
      const out = computeRepoThemes({
        commits: commits(10, 'fix: crash', ['r1']),
        repositories: REPOS,
        repoId: 'r1',
      });
      assert.equal(out.items[0].confidence, 'High');

      const cross = computeThemes({ commits: commits(10, 'fix: crash', ['r1']), repositories: REPOS });
      assert.equal(cross.items[0].confidence, 'Medium', 'cross-repo scope still requires 2 repos');
    });

    it('never exposes commit bodies', () => {
      const out = computeRepoThemes({
        commits: [{ sha: 'a1', repoId: 'r1', messageHeadline: 'fix: crash', messageFull: 'SECRET BODY' }],
        repositories: REPOS,
        repoId: 'r1',
      });
      assert.ok(!JSON.stringify(out).includes('SECRET BODY'));
    });
  });

  describe('pickTopTheme — deterministic top-theme selection (Phase 10.2)', () => {
    it('returns null for an empty item list', () => {
      assert.equal(pickTopTheme([]), null);
      assert.equal(pickTopTheme(null), null);
    });

    it('picks the highest-count theme', () => {
      const top = pickTopTheme([
        { theme: 'Feature', commitCount: 5, share: 0.5, confidence: 'High' },
        { theme: 'Bug fix', commitCount: 9, share: 0.45, confidence: 'High' },
      ]);
      assert.equal(top.theme, 'Bug fix');
      assert.equal(top.commitCount, 9);
    });

    it('breaks ties by the documented theme priority (not input order)', () => {
      const a = [
        { theme: 'Feature', commitCount: 4, share: 0.5, confidence: 'Medium' },
        { theme: 'Bug fix', commitCount: 4, share: 0.5, confidence: 'Medium' },
      ];
      const b = [...a].reverse();
      assert.equal(pickTopTheme(a).theme, 'Bug fix', 'Bug fix outranks Feature in THEME_PRIORITY');
      assert.equal(pickTopTheme(b).theme, 'Bug fix', 'tie-break is order-independent');
    });

    it('breaks ties by priority even when a lower-priority theme has a higher share', () => {
      const top = pickTopTheme([
        { theme: 'Feature', commitCount: 5, share: 0.6, confidence: 'High' },
        { theme: 'Security', commitCount: 5, share: 0.4, confidence: 'High' },
      ]);
      assert.equal(top.theme, 'Security', 'Security outranks Feature in THEME_PRIORITY');
    });
  });

  describe('computeRepoThemesMap — one map for the whole page (Phase 10.2)', () => {
    it('gives every repository an entry, including empty ones', () => {
      const commitsFor = [
        { sha: 'a1', repoId: 'r1', messageHeadline: 'fix: crash' },
        { sha: 'b1', repoId: 'r2', messageHeadline: 'feat: other' },
      ];
      const map = computeRepoThemesMap({ commits: commitsFor, repositories: REPOS });

      assert.ok(Object.prototype.hasOwnProperty.call(map, 'r1'));
      assert.ok(Object.prototype.hasOwnProperty.call(map, 'r2'));
      assert.equal(map.r1.themedCommits, 1);
      assert.equal(map.r2.themedCommits, 1);
      assert.equal(map.r1.topTheme.theme, 'Bug fix');
      assert.equal(map.r2.topTheme.theme, 'Feature');
    });

    it('a repository with no commits gets an empty entry with a null topTheme', () => {
      const map = computeRepoThemesMap({
        commits: [{ sha: 'a1', repoId: 'r1', messageHeadline: 'fix: crash' }],
        repositories: REPOS,
      });
      assert.equal(map.r2.totalCommits, 0);
      assert.equal(map.r2.topTheme, null);
      assert.deepEqual(map.r2.items, []);
    });

    it('skips malformed repository entries without crashing', () => {
      const map = computeRepoThemesMap({
        commits: [{ sha: 'a1', repoId: 'r1', messageHeadline: 'fix: crash' }],
        repositories: [null, undefined, { fullName: 'no/id' }, ...REPOS],
      });
      assert.equal(Object.keys(map).length, 2, 'only well-formed repos get entries');
      assert.ok(Object.prototype.hasOwnProperty.call(map, 'r1'));
    });

    it('commits with a missing repoId are ignored', () => {
      const map = computeRepoThemesMap({
        commits: [
          { sha: 'a1', messageHeadline: 'fix: crash' },
          { sha: 'a2', repoId: 'r1', messageHeadline: 'fix: crash' },
        ],
        repositories: REPOS,
      });
      assert.equal(map.r1.totalCommits, 1, 'the repoId-less commit must not be counted');
    });
  });

  describe('canonical ranking — the chip and the drill-down agree (Phase 10.2)', () => {
    it('topTheme IS the first displayed item', () => {
      // The defect: `pickTopTheme` broke a count tie by THEME_PRIORITY
      // (Testing before Feature), while the displayed list broke the same tie
      // alphabetically (Feature before Testing). The chip therefore said
      // "Testing" while the panel's first row said "Feature".
      const docs = [
        { sha: 'a1', repoId: 'r1', messageHeadline: 'feat: add thing' },
        { sha: 'a2', repoId: 'r1', messageHeadline: 'test: cover thing' },
      ];
      const out = computeRepoThemes({ commits: docs, repositories: REPOS, repoId: 'r1' });

      assert.ok(out.topTheme, 'a top theme must be selected');
      assert.equal(
        out.topTheme.theme,
        out.items[0].theme,
        'the chip must name the SAME theme as the first displayed row'
      );
      assert.equal(out.topTheme.commitCount, out.items[0].commitCount);
      assert.equal(out.topTheme.share, out.items[0].share);
      assert.equal(out.topTheme.confidence, out.items[0].confidence);
    });

    it('the agreement holds for every theme combination', () => {
      const headlines = ['fix: a', 'feat: b', 'test: c', 'docs: d', 'refactor: e', 'perf: f', 'security: g'];
      // Every ordered pair of themes, each once — the confidence tiers differ
      // (Low/Medium), so the two rankings could previously diverge.
      for (const a of headlines) {
        for (const b of headlines) {
          const out = computeRepoThemes({
            commits: [
              { sha: 'x1', repoId: 'r1', messageHeadline: a },
              { sha: 'x2', repoId: 'r1', messageHeadline: b },
            ],
            repositories: REPOS,
            repoId: 'r1',
          });
          assert.equal(out.topTheme.theme, out.items[0].theme, `chip/panel mismatch for "${a}" + "${b}"`);
        }
      }
    });

    it('the ranking does not depend on input order', () => {
      const docs = [
        { sha: 'a1', repoId: 'r1', messageHeadline: 'feat: add thing' },
        { sha: 'a2', repoId: 'r1', messageHeadline: 'test: cover thing' },
        { sha: 'a3', repoId: 'r1', messageHeadline: 'fix: repair thing' },
      ];
      const forward = computeRepoThemes({ commits: docs, repositories: REPOS, repoId: 'r1' });
      const reversed = computeRepoThemes({
        commits: [...docs].reverse(),
        repositories: REPOS,
        repoId: 'r1',
      });
      const shuffled = computeRepoThemes({
        commits: [docs[1], docs[2], docs[0]],
        repositories: REPOS,
        repoId: 'r1',
      });

      assert.deepEqual(forward, reversed);
      assert.deepEqual(forward, shuffled);
      assert.equal(forward.topTheme.theme, forward.items[0].theme);
    });

    it('counts, confidence and shares stay internally consistent', () => {
      const docs = [
        { sha: 'a1', repoId: 'r1', messageHeadline: 'fix: a' },
        { sha: 'a2', repoId: 'r1', messageHeadline: 'fix: b' },
        { sha: 'a3', repoId: 'r1', messageHeadline: 'feat: c' },
        { sha: 'a4', repoId: 'r1', messageHeadline: 'chore: bump' },
        { sha: 'a5', repoId: 'r1', messageHeadline: null },
        { sha: 'a6', repoId: 'r1', messageHeadline: 'random words here' },
      ];
      const out = computeRepoThemes({ commits: docs, repositories: REPOS, repoId: 'r1' });

      assert.equal(out.totalCommits, 6);
      assert.equal(out.themedCommits, 3);
      assert.equal(out.noise, 1);
      assert.equal(out.noMessage, 1);
      assert.equal(out.unclassified, 1);
      assert.equal(
        out.totalCommits,
        out.themedCommits + out.unclassified + out.noMessage + out.noise,
        'the buckets must reconcile'
      );

      const sum = out.items.reduce((s, i) => s + i.share, 0);
      assert.ok(Math.abs(sum - 1) < 0.001, 'shares must sum to 1 over the themed denominator');
      for (const item of out.items) {
        assert.ok(Math.abs(item.share - item.commitCount / out.themedCommits) < 0.002);
        assert.ok(['High', 'Medium', 'Low'].includes(item.confidence));
      }
      // The item list is sorted by the canonical comparator.
      const sorted = [...out.items].sort(compareThemeItems);
      assert.deepEqual(
        out.items.map((i) => i.theme),
        sorted.map((i) => i.theme)
      );
    });
  });

  describe('malformed commit records are handled safely (Phase 10.2)', () => {
    it('a null commit in the middle of valid records does not crash', () => {
      const docs = [
        { sha: 'a1', repoId: 'r1', messageHeadline: 'fix: first' },
        null,
        { sha: 'a2', repoId: 'r1', messageHeadline: 'fix: second' },
      ];
      const out = computeRepoThemes({ commits: docs, repositories: REPOS, repoId: 'r1' });
      assert.equal(out.totalCommits, 2, 'the malformed record is not counted as a commit');
      assert.equal(out.themedCommits, 2, 'its valid siblings are still processed');
      assert.equal(out.items[0].commitCount, 2);
    });

    it('undefined, non-object and empty records are skipped', () => {
      const out = computeRepoThemes({
        commits: [
          undefined,
          null,
          'not-a-commit',
          42,
          [],
          { sha: 'a1', repoId: 'r1', messageHeadline: 'fix: valid' },
        ],
        repositories: REPOS,
        repoId: 'r1',
      });
      assert.equal(out.totalCommits, 1, 'only the one valid record is counted');
      assert.equal(out.themedCommits, 1);
      assert.equal(out.items[0].theme, 'Bug fix');
    });

    it('a commit with no message fields lands in the noMessage bucket', () => {
      const out = computeRepoThemes({
        commits: [{ sha: 'a1', repoId: 'r1' }],
        repositories: REPOS,
        repoId: 'r1',
      });
      assert.equal(out.totalCommits, 1);
      assert.equal(out.noMessage, 1);
      assert.equal(out.themedCommits, 0);
      assert.deepEqual(out.items, []);
      assert.equal(out.topTheme, null, 'no chip may be derived from an empty payload');
    });

    it('empty and noise-only messages are counted, never themed', () => {
      const out = computeRepoThemes({
        commits: [
          { sha: 'a1', repoId: 'r1', messageHeadline: '' },
          { sha: 'a2', repoId: 'r1', messageHeadline: '   ' },
          { sha: 'a3', repoId: 'r1', messageHeadline: 'chore: bump deps' },
          { sha: 'a4', repoId: 'r1', messageHeadline: 'Merge pull request #1' },
        ],
        repositories: REPOS,
        repoId: 'r1',
      });
      assert.equal(out.totalCommits, 4);
      assert.equal(out.noMessage, 2);
      assert.equal(out.noise, 2);
      assert.equal(out.themedCommits, 0);
      assert.deepEqual(out.items, []);
    });

    it('the aggregate counters stay correct after malformed records', () => {
      const out = computeRepoThemes({
        commits: [
          { sha: 'a1', repoId: 'r1', messageHeadline: 'fix: one' },
          null,
          { sha: 'a2', repoId: 'r1', messageHeadline: 'feat: two' },
          undefined,
          { sha: 'a3', repoId: 'r1', messageHeadline: 'chore: bump' },
          { sha: 'a4', repoId: 'r1' },
        ],
        repositories: REPOS,
        repoId: 'r1',
      });
      assert.equal(out.totalCommits, 4);
      assert.equal(out.themedCommits, 2);
      assert.equal(out.noise, 1);
      assert.equal(out.noMessage, 1);
      assert.equal(out.totalCommits, out.themedCommits + out.unclassified + out.noMessage + out.noise);
    });

    it('a repository with only malformed records produces an empty, chip-free payload', () => {
      const out = computeRepoThemes({
        commits: [null, undefined, { sha: 'a1', repoId: 'r1' }],
        repositories: REPOS,
        repoId: 'r1',
      });
      assert.equal(out.topTheme, null);
      assert.equal(out.themedCommits, 0);
      assert.deepEqual(out.items, []);
    });
  });
});
