/**
 * Focus-area tagging tests (T4.1)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  FOCUS_RULES_VERSION,
  FOCUS_RULES,
  computeFocusTags,
  computeRepoFocusTags,
} = require('../src/services/intelligence/focus');

describe('focus.js (T4.1)', () => {
  describe('FOCUS_RULES_VERSION', () => {
    it('is 1', () => assert.equal(FOCUS_RULES_VERSION, 1));
  });

  describe('FOCUS_RULES structure', () => {
    it('has expected tags', () => {
      const tags = FOCUS_RULES.map((r) => r.tag);
      assert.ok(tags.includes('API work'));
      assert.ok(tags.includes('Database work'));
      assert.ok(tags.includes('Frontend work'));
      assert.ok(tags.includes('DevOps/Infra'));
      assert.ok(tags.includes('Documentation'));
      assert.ok(tags.includes('Testing'));
      assert.ok(tags.includes('CLI/Tooling'));
    });

    it('each rule has required fields', () => {
      for (const rule of FOCUS_RULES) {
        assert.ok(typeof rule.tag === 'string' && rule.tag.length > 0);
        assert.ok(Array.isArray(rule.keywords) && rule.keywords.length > 0);
        assert.ok(Array.isArray(rule.languages));
        assert.ok(typeof rule.minCommitsForHigh === 'number' && rule.minCommitsForHigh > 0);
        assert.ok(typeof rule.minCommitsForMedium === 'number' && rule.minCommitsForMedium > 0);
      }
    });
  });

  describe('computeFocusTags', () => {
    it('empty input returns empty array', () => {
      const out = computeFocusTags({});
      assert.deepEqual(out, []);
    });

    it('no commits returns empty', () => {
      const out = computeFocusTags({ commits: [], languageSnapshots: [], repositories: [] });
      assert.deepEqual(out, []);
    });

    it('commits without files returns empty', () => {
      const commits = [{ repoId: 'repo1', files: [] }];
      const out = computeFocusTags({ commits, languageSnapshots: [], repositories: [] });
      assert.deepEqual(out, []);
    });

    it('single commit matching API work', () => {
      const commits = [{ repoId: 'repo1', files: ['src/api/routes.ts'] }];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out.length, 1);
      assert.equal(out[0].tag, 'API work');
      assert.equal(out[0].confidence, 'Low'); // 1 commit < 5
      assert.deepEqual(out[0].evidence.repoNames, ['user/repo1']);
      assert.ok(out[0].evidence.filePaths.includes('src/api/routes.ts'));
    });

    it('plain-object bytes (lean docs) behave like Map bytes', () => {
      // Real composer path feeds .lean() documents where the schema Map
      // arrives as a plain object (T9 fix #3) — language filter must match.
      const commits = [{ repoId: 'repo1', files: ['src/api/routes.ts'] }];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const fromMap = computeFocusTags({
        commits,
        languageSnapshots: [
          { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
        ],
        repositories,
      });
      const fromPlain = computeFocusTags({
        commits,
        languageSnapshots: [{ repoId: 'repo1', fetchedAt: new Date(), bytes: { TypeScript: 1000 } }],
        repositories,
      });
      assert.deepEqual(fromPlain, fromMap);
      assert.equal(fromPlain.length, 1);
      assert.equal(fromPlain[0].tag, 'API work');
    });

    it('language filter: API work requires matching language', () => {
      // Commit has API path but repo has only CSS (not in API languages)
      const commits = [{ repoId: 'repo1', files: ['src/api/routes.ts'] }];
      const languageSnapshots = [{ repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['CSS', 1000]]) }];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.deepEqual(out, []);
    });

    it('multiple commits same repo -> Low confidence', () => {
      const commits = [
        { repoId: 'repo1', files: ['src/api/routes.ts'] },
        { repoId: 'repo1', files: ['src/api/handler.ts'] },
        { repoId: 'repo1', files: ['src/api/middleware.ts'] },
        { repoId: 'repo1', files: ['src/api/controller.ts'] },
        { repoId: 'repo1', files: ['src/api/endpoint.ts'] },
      ];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].tag, 'API work');
      assert.equal(out[0].confidence, 'Medium'); // 5 commits >= 5
    });

    it('10 commits across 2 repos -> High confidence', () => {
      const commits = [
        { repoId: 'repo1', files: ['src/api/routes.ts'] },
        { repoId: 'repo1', files: ['src/api/handler.ts'] },
        { repoId: 'repo1', files: ['src/api/middleware.ts'] },
        { repoId: 'repo1', files: ['src/api/controller.ts'] },
        { repoId: 'repo1', files: ['src/api/endpoint.ts'] },
        { repoId: 'repo2', files: ['api/routes.go'] },
        { repoId: 'repo2', files: ['api/handler.go'] },
        { repoId: 'repo2', files: ['api/middleware.go'] },
        { repoId: 'repo2', files: ['api/controller.go'] },
        { repoId: 'repo2', files: ['api/endpoint.go'] },
      ];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
        { repoId: 'repo2', fetchedAt: new Date(), bytes: new Map([['Go', 1000]]) },
      ];
      const repositories = [
        { _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' },
        { _id: 'repo2', fullName: 'user/repo2', owner: 'user', name: 'repo2' },
      ];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].tag, 'API work');
      assert.equal(out[0].confidence, 'High'); // 10 commits, 2 repos
    });

    it('multiple focus tags sorted by confidence then repos', () => {
      const commits = [
        // API work: 5 commits, 1 repo -> Medium (minCommitsForMedium = 5)
        { repoId: 'repo1', files: ['src/api/routes.ts'] },
        { repoId: 'repo1', files: ['src/api/handler.ts'] },
        { repoId: 'repo1', files: ['src/api/middleware.ts'] },
        { repoId: 'repo1', files: ['src/api/controller.ts'] },
        { repoId: 'repo1', files: ['src/api/endpoint.ts'] },
        // Frontend work: 2 commits, 1 repo -> Low
        { repoId: 'repo1', files: ['src/components/Button.tsx'] },
        { repoId: 'repo1', files: ['src/pages/Home.tsx'] },
      ];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out.length, 2);
      assert.equal(out[0].tag, 'API work');
      assert.equal(out[0].confidence, 'Medium');
      assert.equal(out[1].tag, 'Frontend work');
      assert.equal(out[1].confidence, 'Low');
    });

    it('evidence includes repoNames and filePaths (max 5)', () => {
      const commits = Array.from({ length: 10 }, (_, i) => ({
        repoId: 'repo1',
        files: [`src/api/file${i}.ts`],
      }));
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.deepEqual(out[0].evidence.repoNames, ['user/repo1']);
      assert.equal(out[0].evidence.filePaths.length, 5);
      assert.ok(out[0].evidence.filePaths.includes('src/api/file0.ts'));
    });

    it('file paths deduplicated in evidence', () => {
      const commits = [
        { repoId: 'repo1', files: ['src/api/routes.ts'] },
        { repoId: 'repo1', files: ['src/api/routes.ts'] }, // duplicate
        { repoId: 'repo1', files: ['src/api/handler.ts'] },
      ];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].evidence.filePaths.filter((f) => f === 'src/api/routes.ts').length, 1);
    });

    it('database work matches migration/schema keywords', () => {
      const commits = [
        { repoId: 'repo1', files: ['db/migrations/001_create_users.sql'] },
        { repoId: 'repo1', files: ['db/schema.prisma'] },
        { repoId: 'repo1', files: ['models/User.ts'] },
        { repoId: 'repo1', files: ['repositories/UserRepository.ts'] },
        { repoId: 'repo1', files: ['orm/config.ts'] },
      ];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date(),
          bytes: new Map([
            ['TypeScript', 1000],
            ['SQL', 500],
          ]),
        },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].tag, 'Database work');
      assert.equal(out[0].confidence, 'Medium');
    });

    it('devops/infra matches docker/k8s keywords', () => {
      const commits = [
        { repoId: 'repo1', files: ['Dockerfile'] },
        { repoId: 'repo1', files: ['k8s/deployment.yaml'] },
        { repoId: 'repo1', files: ['.github/workflows/ci.yml'] },
        { repoId: 'repo1', files: ['terraform/main.tf'] },
        { repoId: 'repo1', files: ['ansible/playbook.yml'] },
      ];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date(),
          bytes: new Map([
            ['YAML', 500],
            ['Dockerfile', 200],
            ['HCL', 300],
          ]),
        },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].tag, 'DevOps/Infra');
      assert.equal(out[0].confidence, 'Medium');
    });

    it('documentation matches readme/doc keywords', () => {
      const commits = [
        { repoId: 'repo1', files: ['README.md'] },
        { repoId: 'repo1', files: ['docs/guide.mdx'] },
        { repoId: 'repo1', files: ['CHANGELOG.md'] },
      ];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['Markdown', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].tag, 'Documentation');
      assert.equal(out[0].confidence, 'Medium'); // 3 commits >= minCommitsForMedium (3)
    });

    it('testing matches test/spec keywords', () => {
      const commits = [
        { repoId: 'repo1', files: ['src/__tests__/api.test.ts'] },
        { repoId: 'repo1', files: ['src/components/Button.spec.tsx'] },
        { repoId: 'repo1', files: ['cypress/e2e/login.cy.ts'] },
        { repoId: 'repo1', files: ['jest.config.js'] },
        { repoId: 'repo1', files: ['vitest.config.ts'] },
      ];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date(),
          bytes: new Map([
            ['TypeScript', 1000],
            ['JavaScript', 500],
          ]),
        },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].tag, 'Testing');
      assert.equal(out[0].confidence, 'Medium');
    });

    it('CLI/tooling matches cli/command keywords', () => {
      const commits = [
        { repoId: 'repo1', files: ['cli/commands/deploy.ts'] },
        { repoId: 'repo1', files: ['bin/run.js'] },
        { repoId: 'repo1', files: ['scripts/build.sh'] },
        { repoId: 'repo1', files: ['tools/generator.py'] },
        { repoId: 'repo1', files: ['cobra/cmd/root.go'] },
      ];
      const languageSnapshots = [
        {
          repoId: 'repo1',
          fetchedAt: new Date(),
          bytes: new Map([
            ['TypeScript', 500],
            ['JavaScript', 500],
            ['Shell', 300],
            ['Python', 200],
            ['Go', 100],
          ]),
        },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].tag, 'CLI/Tooling');
      assert.equal(out[0].confidence, 'Medium');
    });

    it('language case-insensitive matching', () => {
      const commits = [{ repoId: 'repo1', files: ['src/api/routes.ts'] }];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TYPESCRIPT', 1000]]) },
      ]; // uppercase
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.equal(out[0].tag, 'API work');
    });

    it('uses latest snapshot per repo', () => {
      const commits = [{ repoId: 'repo1', files: ['src/api/routes.ts'] }];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date('2024-01-01'), bytes: new Map([['Python', 1000]]) },
        { repoId: 'repo1', fetchedAt: new Date('2024-01-31'), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      // Should use latest (TypeScript) -> matches API work
      assert.equal(out[0].tag, 'API work');
    });

    it('repo without snapshot gets no language match', () => {
      const commits = [{ repoId: 'repo1', files: ['src/api/routes.ts'] }];
      const languageSnapshots = [];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.deepEqual(out, []);
    });

    it('deterministic: same input produces same output', () => {
      const commits = [{ repoId: 'repo1', files: ['src/api/routes.ts'] }];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out1 = computeFocusTags({ commits, languageSnapshots, repositories });
      const out2 = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.deepEqual(out1, out2);
    });

    it('commits without repoId ignored', () => {
      const commits = [{ files: ['src/api/routes.ts'] }];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [{ _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' }];
      const out = computeFocusTags({ commits, languageSnapshots, repositories });
      assert.deepEqual(out, []);
    });
  });

  describe('computeRepoFocusTags', () => {
    it('filters by repoId', () => {
      const commits = [
        { repoId: 'repo1', files: ['src/api/routes.ts'] },
        { repoId: 'repo2', files: ['src/components/Button.tsx'] },
      ];
      const languageSnapshots = [
        { repoId: 'repo1', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
        { repoId: 'repo2', fetchedAt: new Date(), bytes: new Map([['TypeScript', 1000]]) },
      ];
      const repositories = [
        { _id: 'repo1', fullName: 'user/repo1', owner: 'user', name: 'repo1' },
        { _id: 'repo2', fullName: 'user/repo2', owner: 'user', name: 'repo2' },
      ];
      const out = computeRepoFocusTags({ commits, languageSnapshots, repositories, repoId: 'repo1' });
      assert.equal(out.length, 1);
      assert.equal(out[0].tag, 'API work');
      assert.deepEqual(out[0].evidence.repoNames, ['user/repo1']);
    });
  });
});
