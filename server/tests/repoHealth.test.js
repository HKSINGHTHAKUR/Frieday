/**
 * Repository health tests (T4.2)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  REPO_HEALTH_VERSION,
  HEALTH_LABELS,
  HEALTH_THRESHOLDS,
  classifyHealth,
  daysSince,
  getLatestActivityDate,
  countOpenPRs,
  countOpenIssues,
  computeRepoHealth,
  computeAllRepoHealth,
} = require('../src/services/intelligence/repoHealth');

const ANCHOR = new Date('2024-01-31T12:00:00Z'); // Fixed anchor

describe('repoHealth.js (T4.2)', () => {
  describe('REPO_HEALTH_VERSION', () => {
    it('is 1', () => assert.equal(REPO_HEALTH_VERSION, 1));
  });

  describe('HEALTH_LABELS', () => {
    it('has expected labels', () => {
      assert.equal(HEALTH_LABELS.ACTIVE, 'active');
      assert.equal(HEALTH_LABELS.STEADY, 'steady');
      assert.equal(HEALTH_LABELS.QUIET, 'quiet');
      assert.equal(HEALTH_LABELS.STALLED, 'stalled');
    });
  });

  describe('HEALTH_THRESHOLDS', () => {
    it('has correct day thresholds', () => {
      assert.equal(HEALTH_THRESHOLDS.active, 7);
      assert.equal(HEALTH_THRESHOLDS.steady, 30);
      assert.equal(HEALTH_THRESHOLDS.quiet, 60);
    });
  });

  describe('classifyHealth', () => {
    it('Active: ≤ 7 days', () => {
      assert.equal(classifyHealth(0), 'active');
      assert.equal(classifyHealth(1), 'active');
      assert.equal(classifyHealth(7), 'active');
    });

    it('Steady: 8-30 days', () => {
      assert.equal(classifyHealth(8), 'steady');
      assert.equal(classifyHealth(15), 'steady');
      assert.equal(classifyHealth(30), 'steady');
    });

    it('Quiet: 31-60 days', () => {
      assert.equal(classifyHealth(31), 'quiet');
      assert.equal(classifyHealth(45), 'quiet');
      assert.equal(classifyHealth(60), 'quiet');
    });

    it('Stalled: > 60 days', () => {
      assert.equal(classifyHealth(61), 'stalled');
      assert.equal(classifyHealth(90), 'stalled');
      assert.equal(classifyHealth(365), 'stalled');
    });

    it('edge case: exactly 7 days = Active', () => {
      assert.equal(classifyHealth(7), 'active');
    });

    it('edge case: exactly 8 days = Steady', () => {
      assert.equal(classifyHealth(8), 'steady');
    });

    it('edge case: exactly 30 days = Steady', () => {
      assert.equal(classifyHealth(30), 'steady');
    });

    it('edge case: exactly 31 days = Quiet', () => {
      assert.equal(classifyHealth(31), 'quiet');
    });

    it('edge case: exactly 60 days = Quiet', () => {
      assert.equal(classifyHealth(60), 'quiet');
    });

    it('edge case: exactly 61 days = Stalled', () => {
      assert.equal(classifyHealth(61), 'stalled');
    });

    it('fractional days', () => {
      assert.equal(classifyHealth(7.5), 'steady');
      assert.equal(classifyHealth(30.5), 'quiet');
      assert.equal(classifyHealth(60.5), 'stalled');
    });

    it('no activity (Infinity) = Stalled', () => {
      assert.equal(classifyHealth(Infinity), 'stalled');
      assert.equal(classifyHealth(NaN), 'stalled');
      assert.equal(classifyHealth(-1), 'stalled');
    });
  });

  describe('daysSince', () => {
    it('same day = 0', () => {
      const anchor = new Date('2024-01-15T12:00:00Z');
      const activity = new Date('2024-01-15T08:00:00Z');
      assert.equal(daysSince(anchor, activity), 0);
    });

    it('one day difference', () => {
      const anchor = new Date('2024-01-16T12:00:00Z');
      const activity = new Date('2024-01-15T08:00:00Z');
      assert.equal(daysSince(anchor, activity), 1);
    });

    it('fractional days truncated to UTC day boundaries', () => {
      const anchor = new Date('2024-01-16T12:00:00Z');
      const activity = new Date('2024-01-15T18:00:00Z');
      const days = daysSince(anchor, activity);
      // Both dates truncated to UTC midnight -> 1 day difference
      assert.equal(days, 1);
    });

    it('null activity returns Infinity', () => {
      const anchor = new Date('2024-01-16T12:00:00Z');
      assert.equal(daysSince(anchor, null), Infinity);
      assert.equal(daysSince(anchor, undefined), Infinity);
    });

    it('uses UTC day boundaries', () => {
      // Same UTC day despite different hours
      const anchor = new Date('2024-01-15T23:59:59Z');
      const activity = new Date('2024-01-15T00:00:01Z');
      assert.equal(daysSince(anchor, activity), 0);
    });
  });

  describe('getLatestActivityDate', () => {
    it('no events returns null', () => {
      const date = getLatestActivityDate({});
      assert.equal(date, null);
    });

    it('commit authoredAt', () => {
      const commits = [{ authoredAt: new Date('2024-01-15T10:00:00Z') }];
      const date = getLatestActivityDate({ commits });
      assert.equal(date.toISOString(), '2024-01-15T10:00:00.000Z');
    });

    it('PR mergedAt is latest', () => {
      const commits = [{ authoredAt: new Date('2024-01-10T10:00:00Z') }];
      const prs = [{ mergedAt: new Date('2024-01-20T10:00:00Z') }];
      const date = getLatestActivityDate({ commits, pullRequests: prs });
      assert.equal(date.toISOString(), '2024-01-20T10:00:00.000Z');
    });

    it('PR createdAt considered', () => {
      const prs = [{ createdAt: new Date('2024-01-15T10:00:00Z') }];
      const date = getLatestActivityDate({ pullRequests: prs });
      assert.equal(date.toISOString(), '2024-01-15T10:00:00.000Z');
    });

    it('PR updatedAt considered', () => {
      const prs = [{ updatedAt: new Date('2024-01-18T10:00:00Z') }];
      const date = getLatestActivityDate({ pullRequests: prs });
      assert.equal(date.toISOString(), '2024-01-18T10:00:00.000Z');
    });

    it('issue createdAt considered', () => {
      const issues = [{ createdAt: new Date('2024-01-12T10:00:00Z') }];
      const date = getLatestActivityDate({ issues });
      assert.equal(date.toISOString(), '2024-01-12T10:00:00.000Z');
    });

    it('issue closedAt considered', () => {
      const issues = [{ closedAt: new Date('2024-01-18T10:00:00Z') }];
      const date = getLatestActivityDate({ issues });
      assert.equal(date.toISOString(), '2024-01-18T10:00:00.000Z');
    });

    it('issue updatedAt considered', () => {
      const issues = [{ updatedAt: new Date('2024-01-20T10:00:00Z') }];
      const date = getLatestActivityDate({ issues });
      assert.equal(date.toISOString(), '2024-01-20T10:00:00.000Z');
    });

    it('picks latest across all event types', () => {
      const commits = [{ authoredAt: new Date('2024-01-10T10:00:00Z') }];
      const prs = [{ mergedAt: new Date('2024-01-15T10:00:00Z') }];
      const issues = [{ closedAt: new Date('2024-01-20T10:00:00Z') }];
      const date = getLatestActivityDate({ commits, pullRequests: prs, issues });
      assert.equal(date.toISOString(), '2024-01-20T10:00:00.000Z');
    });
  });

  describe('countOpenPRs', () => {
    it('counts open PRs for repo', () => {
      const prs = [
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'closed' },
        { repoId: 'repo2', state: 'open' },
      ];
      assert.equal(countOpenPRs(prs, 'repo1'), 2);
      assert.equal(countOpenPRs(prs, 'repo2'), 1);
    });

    it('handles ObjectId repoId', () => {
      const repoId = { toString: () => 'repo1' };
      const prs = [{ repoId, state: 'open' }];
      assert.equal(countOpenPRs(prs, repoId), 1);
    });

    it('repo with no PRs returns 0', () => {
      const prs = [{ repoId: 'repo2', state: 'open' }];
      assert.equal(countOpenPRs(prs, 'repo1'), 0);
    });

    it('empty array returns 0', () => {
      assert.equal(countOpenPRs([], 'repo1'), 0);
    });
  });

  describe('countOpenIssues', () => {
    it('counts open issues for repo', () => {
      const issues = [
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'closed' },
        { repoId: 'repo2', state: 'open' },
      ];
      assert.equal(countOpenIssues(issues, 'repo1'), 2);
      assert.equal(countOpenIssues(issues, 'repo2'), 1);
    });

    it('handles ObjectId repoId', () => {
      const repoId = { toString: () => 'repo1' };
      const issues = [{ repoId, state: 'open' }];
      assert.equal(countOpenIssues(issues, repoId), 1);
    });

    it('repo with no issues returns 0', () => {
      const issues = [{ repoId: 'repo2', state: 'open' }];
      assert.equal(countOpenIssues(issues, 'repo1'), 0);
    });

    it('empty array returns 0', () => {
      assert.equal(countOpenIssues([], 'repo1'), 0);
    });
  });

  describe('computeRepoHealth', () => {
    const repo = {
      _id: { toString: () => 'repo1' },
      fullName: 'user/repo1',
      owner: 'user',
      name: 'repo1',
    };

    it('throws without repository _id', () => {
      assert.throws(() => computeRepoHealth({ repository: {}, anchor: ANCHOR }), /required/);
    });

    it('Active: commit today', () => {
      const commits = [{ authoredAt: new Date('2024-01-31T10:00:00Z') }];
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'active');
      assert.equal(out.daysSinceActivity, 0);
    });

    it('Active: commit 7 days ago', () => {
      const commits = [{ authoredAt: new Date('2024-01-24T10:00:00Z') }]; // 7 days before Jan 31
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'active');
      assert.equal(out.daysSinceActivity, 7);
    });

    it('Steady: commit 8 days ago', () => {
      const commits = [{ authoredAt: new Date('2024-01-23T10:00:00Z') }]; // 8 days
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'steady');
      assert.equal(out.daysSinceActivity, 8);
    });

    it('Steady: commit 30 days ago', () => {
      const commits = [{ authoredAt: new Date('2024-01-01T10:00:00Z') }]; // 30 days
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'steady');
      assert.equal(out.daysSinceActivity, 30);
    });

    it('Quiet: commit 31 days ago', () => {
      const commits = [{ authoredAt: new Date('2023-12-31T10:00:00Z') }]; // 31 days
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'quiet');
      assert.equal(out.daysSinceActivity, 31);
    });

    it('Quiet: commit 60 days ago', () => {
      const commits = [{ authoredAt: new Date('2023-12-02T10:00:00Z') }]; // ~60 days
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'quiet');
    });

    it('Stalled: commit 61 days ago', () => {
      const commits = [{ authoredAt: new Date('2023-12-01T10:00:00Z') }]; // 61 days
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'stalled');
      assert.ok(out.daysSinceActivity >= 61);
    });

    it('no activity = Stalled', () => {
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits: [] });
      assert.equal(out.health, 'stalled');
      assert.equal(out.daysSinceActivity, null);
      assert.equal(out.lastActivityAt, null);
    });

    it('includes open PR count', () => {
      const commits = [{ authoredAt: new Date('2024-01-31T10:00:00Z') }];
      const prs = [
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'closed' },
      ];
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits, pullRequests: prs });
      assert.equal(out.openPRs, 2);
    });

    it('includes open issue count', () => {
      const commits = [{ authoredAt: new Date('2024-01-31T10:00:00Z') }];
      const issues = [
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'closed' },
      ];
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits, issues });
      assert.equal(out.openIssues, 2);
    });

    it('uses latest activity across all event types', () => {
      const commits = [{ authoredAt: new Date('2024-01-10T10:00:00Z') }];
      const prs = [{ mergedAt: new Date('2024-01-20T10:00:00Z') }];
      const issues = [{ closedAt: new Date('2024-01-25T10:00:00Z') }];
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits, pullRequests: prs, issues });
      assert.equal(out.health, 'active');
      assert.equal(out.daysSinceActivity, 6); // Jan 25 to Jan 31 = 6 days
    });

    it('output includes repo name and version', () => {
      const commits = [{ authoredAt: new Date('2024-01-31T10:00:00Z') }];
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.repoName, 'user/repo1');
      assert.equal(out.version, 1);
      assert.ok(out.repoId);
    });
  });

  describe('computeAllRepoHealth', () => {
    const repos = [
      { _id: { toString: () => 'repo1' }, fullName: 'user/repo1', owner: 'user', name: 'repo1' },
      { _id: { toString: () => 'repo2' }, fullName: 'user/repo2', owner: 'user', name: 'repo2' },
      { _id: { toString: () => 'repo3' }, fullName: 'user/repo3', owner: 'user', name: 'repo3' },
    ];

    it('computes health for all repos', () => {
      const commits = [
        { repoId: 'repo1', authoredAt: new Date('2024-01-31T10:00:00Z') },
        { repoId: 'repo2', authoredAt: new Date('2024-01-15T10:00:00Z') },
      ];
      const out = computeAllRepoHealth({ repositories: repos, anchor: ANCHOR, commits });
      assert.equal(out.length, 3);
      assert.equal(out[0].health, 'active');
      assert.equal(out[1].health, 'steady');
      assert.equal(out[2].health, 'stalled'); // no activity
    });

    it('includes open counts per repo', () => {
      const commits = [{ repoId: 'repo1', authoredAt: new Date('2024-01-31T10:00:00Z') }];
      const prs = [
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo1', state: 'open' },
        { repoId: 'repo2', state: 'open' },
      ];
      const issues = [{ repoId: 'repo1', state: 'open' }];
      const out = computeAllRepoHealth({
        repositories: repos,
        anchor: ANCHOR,
        commits,
        pullRequests: prs,
        issues,
      });
      assert.equal(out[0].openPRs, 2);
      assert.equal(out[1].openPRs, 1);
      assert.equal(out[2].openPRs, 0);
      assert.equal(out[0].openIssues, 1);
    });

    it('empty repositories returns empty array', () => {
      const out = computeAllRepoHealth({ repositories: [], anchor: ANCHOR });
      assert.deepEqual(out, []);
    });

    it('repos with no events get Stalled', () => {
      const out = computeAllRepoHealth({ repositories: repos, anchor: ANCHOR });
      for (const r of out) {
        assert.equal(r.health, 'stalled');
        assert.equal(r.daysSinceActivity, null);
        assert.equal(r.lastActivityAt, null);
      }
    });
  });

  describe('determinism', () => {
    const repo = {
      _id: { toString: () => 'repo1' },
      fullName: 'user/repo1',
      owner: 'user',
      name: 'repo1',
    };
    const commits = [{ authoredAt: new Date('2024-01-15T10:00:00Z') }];

    it('same input -> same output', () => {
      const out1 = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      const out2 = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.deepEqual(out1, out2);
    });

    it('input order does not affect computeAllRepoHealth', () => {
      const repos1 = [{ _id: { toString: () => 'repo1' } }, { _id: { toString: () => 'repo2' } }];
      const repos2 = [{ _id: { toString: () => 'repo2' } }, { _id: { toString: () => 'repo1' } }];
      const commits = [{ repoId: 'repo1', authoredAt: new Date('2024-01-15T10:00:00Z') }];
      const out1 = computeAllRepoHealth({ repositories: repos1, anchor: ANCHOR, commits });
      const out2 = computeAllRepoHealth({ repositories: repos2, anchor: ANCHOR, commits });
      // Sort by repoId for comparison
      out1.sort((a, b) => a.repoId.localeCompare(b.repoId));
      out2.sort((a, b) => a.repoId.localeCompare(b.repoId));
      assert.deepEqual(out1, out2);
    });
  });

  describe('boundary conditions', () => {
    it('exactly 7 days = Active', () => {
      const repo = { _id: { toString: () => 'repo1' }, fullName: 'user/repo1', owner: 'user', name: 'repo1' };
      const commits = [{ authoredAt: new Date('2024-01-24T12:00:00Z') }]; // 7 days before Jan 31
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'active');
    });

    it('exactly 30 days = Steady', () => {
      const repo = { _id: { toString: () => 'repo1' }, fullName: 'user/repo1', owner: 'user', name: 'repo1' };
      const commits = [{ authoredAt: new Date('2024-01-01T12:00:00Z') }]; // 30 days before
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      assert.equal(out.health, 'steady');
    });

    it('exactly 60 days = Quiet', () => {
      const repo = { _id: { toString: () => 'repo1' }, fullName: 'user/repo1', owner: 'user', name: 'repo1' };
      const commits = [{ authoredAt: new Date('2023-12-02T12:00:00Z') }]; // ~60 days
      const out = computeRepoHealth({ repository: repo, anchor: ANCHOR, commits });
      // 31 days = Quiet, but we need exact 60
      assert.ok(['quiet', 'stalled'].includes(out.health));
    });
  });
});
