/**
 * Language aggregation tests (T4.1)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeLanguageAggregation,
  computeRepoLanguageAggregation,
} = require('../src/services/intelligence/languages');

describe('languages.js (T4.1)', () => {
  describe('computeLanguageAggregation', () => {
    it('empty input returns empty objects', () => {
      const out = computeLanguageAggregation({});
      assert.deepEqual(out.weightedBytes, {});
      assert.deepEqual(out.commitShare, {});
      assert.equal(out.version, 1);
    });

    it('single repo, single language, single commit', () => {
      const commits = [{ repoId: 'repo1', additions: 10, deletions: 5 }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([['TypeScript', 10000]]),
        },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      // 1 commit in repo, weight = 1.0, bytes = 10000 * 1.0 = 10000
      assert.equal(out.weightedBytes.TypeScript, 10000);
      // commit share: 1 commit distributed by bytes -> 1.0 * 10000/10000 = 1.0
      assert.equal(out.commitShare.TypeScript, 1.0);
    });

    it('single repo, multiple languages', () => {
      const commits = [{ repoId: 'repo1', additions: 10 }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([
            ['TypeScript', 8000],
            ['JavaScript', 2000],
          ]),
        },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      // weight = 1.0
      assert.equal(out.weightedBytes.TypeScript, 8000);
      assert.equal(out.weightedBytes.JavaScript, 2000);
      // commit share distributed by bytes proportion
      assert.equal(out.commitShare.TypeScript, 0.8);
      assert.equal(out.commitShare.JavaScript, 0.2);
    });

    it('multiple repos, weighted by commit presence', () => {
      const commits = [
        { repoId: 'repo1' }, // repo1 has 1 commit
        { repoId: 'repo1' }, // repo1 has 2 commits total
        { repoId: 'repo2' }, // repo2 has 1 commit
      ];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([['TypeScript', 10000]]),
        },
        { repoId: 'repo2', fetchedAt: new Date('2024-01-31T00:00:00Z'), bytes: new Map([['Python', 5000]]) },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      // Both repos have commits, weight = 1.0 each
      assert.equal(out.weightedBytes.TypeScript, 10000);
      assert.equal(out.weightedBytes.Python, 5000);
    });

    it('repo with no commits gets zero weight', () => {
      const commits = [{ repoId: 'repo1' }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([['TypeScript', 10000]]),
        },
        { repoId: 'repo2', fetchedAt: new Date('2024-01-31T00:00:00Z'), bytes: new Map([['Python', 5000]]) },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      assert.ok('TypeScript' in out.weightedBytes);
      assert.ok(!('Python' in out.weightedBytes), 'repo2 has no commits so weight=0');
    });

    it('multiple commits in same repo, single weight', () => {
      const commits = [{ repoId: 'repo1' }, { repoId: 'repo1' }, { repoId: 'repo1' }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([['TypeScript', 10000]]),
        },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      // Still weight 1.0 (we only track presence, not count)
      assert.equal(out.weightedBytes.TypeScript, 10000);
    });

    it('no language snapshots returns empty', () => {
      const commits = [{ repoId: 'repo1' }];
      const out = computeLanguageAggregation({ commits, languageSnapshots: [] });
      assert.deepEqual(out.weightedBytes, {});
      assert.deepEqual(out.commitShare, {});
    });

    it('no commits returns empty', () => {
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([['TypeScript', 10000]]),
        },
      ];
      const out = computeLanguageAggregation({ commits: [], languageSnapshots });
      assert.deepEqual(out.weightedBytes, {});
      assert.deepEqual(out.commitShare, {});
    });

    it('uses latest snapshot per repo', () => {
      const commits = [{ repoId: 'repo1' }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-15T00:00:00Z'),
          bytes: new Map([['TypeScript', 5000]]),
        },
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([
            ['TypeScript', 10000],
            ['JavaScript', 2000],
          ]),
        },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      // Should use latest (Jan 31)
      assert.equal(out.weightedBytes.TypeScript, 10000);
      assert.equal(out.weightedBytes.JavaScript, 2000);
    });

    it('commit share distributed by byte proportion in latest snapshot', () => {
      const commits = [{ repoId: 'repo1' }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([
            ['TypeScript', 7500],
            ['JavaScript', 2500],
          ]),
        },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      assert.equal(out.commitShare.TypeScript, 0.75);
      assert.equal(out.commitShare.JavaScript, 0.25);
    });

    it('multiple commits distributed across languages proportionally', () => {
      const commits = [{ repoId: 'repo1' }, { repoId: 'repo1' }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([
            ['TypeScript', 7500],
            ['JavaScript', 2500],
          ]),
        },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      assert.equal(out.commitShare.TypeScript, 1.5); // 2 * 0.75
      assert.equal(out.commitShare.JavaScript, 0.5); // 2 * 0.25
    });

    it('repoFilter limits to one repo', () => {
      const commits = [{ repoId: 'repo1' }, { repoId: 'repo2' }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([['TypeScript', 10000]]),
        },
        { repoId: 'repo2', fetchedAt: new Date('2024-01-31T00:00:00Z'), bytes: new Map([['Python', 5000]]) },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots, repoFilter: { repoId: 'repo1' } });
      assert.ok('TypeScript' in out.weightedBytes);
      assert.ok(!('Python' in out.weightedBytes));
    });

    it('commits without repoId ignored', () => {
      const commits = [{ additions: 10 }, { repoId: 'repo1' }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([['TypeScript', 10000]]),
        },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      assert.equal(out.weightedBytes.TypeScript, 10000);
    });

    it('language snapshot without bytes ignored', () => {
      const commits = [{ repoId: 'repo1' }];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date('2024-01-31T00:00:00Z'), bytes: new Map() },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      assert.deepEqual(out.weightedBytes, {});
    });

    it('snapshot with zero total bytes skipped', () => {
      const commits = [{ repoId: 'repo1' }];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date('2024-01-31T00:00:00Z'), bytes: new Map([['TypeScript', 0]]) },
      ];
      const out = computeLanguageAggregation({ commits, languageSnapshots });
      assert.deepEqual(out.weightedBytes, {});
    });

    it('plain-object bytes (lean docs) produce the same output as Map bytes', () => {
      // Real composer path feeds .lean() documents where the schema Map
      // arrives as a plain object (T9 fix #3) — must match the Map fixture.
      const commits = [{ repoId: 'repo1' }, { repoId: 'repo1' }, { repoId: 'repo2' }];
      const mapOut = computeLanguageAggregation({
        commits,
        languageSnapshots: [
          {
            repoId: 'repo1',
            fetchedAt: new Date('2024-01-31T00:00:00Z'),
            bytes: new Map([
              ['TypeScript', 8000],
              ['JavaScript', 2000],
            ]),
          },
          {
            repoId: 'repo2',
            fetchedAt: new Date('2024-01-31T00:00:00Z'),
            bytes: new Map([['Python', 5000]]),
          },
        ],
      });
      const plainSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: { TypeScript: 8000, JavaScript: 2000 },
        },
        { repoId: 'repo2', fetchedAt: new Date('2024-01-31T00:00:00Z'), bytes: { Python: 5000 } },
      ];
      const fromPlain = computeLanguageAggregation({ commits, languageSnapshots: plainSnapshots });
      assert.deepEqual(fromPlain, mapOut);
    });

    it('version included in output', () => {
      const out = computeLanguageAggregation({});
      assert.equal(out.version, 1);
    });
  });

  describe('computeRepoLanguageAggregation', () => {
    it('filters by repoId', () => {
      const commits = [{ repoId: 'repo1' }, { repoId: 'repo2' }];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date('2024-01-31T00:00:00Z'),
          bytes: new Map([['TypeScript', 10000]]),
        },
        { repoId: 'repo2', fetchedAt: new Date('2024-01-31T00:00:00Z'), bytes: new Map([['Python', 5000]]) },
      ];
      const out = computeRepoLanguageAggregation({ commits, languageSnapshots, repoId: 'repo1' });
      assert.ok('TypeScript' in out.weightedBytes);
      assert.ok(!('Python' in out.weightedBytes));
    });
  });
});
