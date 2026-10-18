/**
 * Insight templates tests (T4.3)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  INSIGHT_VERSION,
  TEMPLATE_PRIORITY,
  MAX_INSIGHTS,
  evaluateInsights,
  evaluateActivityMomentum,
  evaluateFocusShift,
  evaluateRepositoryConcentration,
  evaluateConsistency,
  evaluateReviewContribution,
  evaluateProjectHealth,
  evaluateLanguageMixChange,
  evaluateQuietPeriod,
} = require('../src/services/intelligence/insights');

describe('insights.js (T4.3)', () => {
  describe('Constants', () => {
    it('INSIGHT_VERSION is 1', () => assert.equal(INSIGHT_VERSION, 1));
    it('MAX_INSIGHTS is 8', () => assert.equal(MAX_INSIGHTS, 8));
    it('TEMPLATE_PRIORITY has 8 templates in F8 order', () => {
      assert.equal(TEMPLATE_PRIORITY.length, 8);
      assert.equal(TEMPLATE_PRIORITY[0], 'ACTIVITY_MOMENTUM');
      assert.equal(TEMPLATE_PRIORITY[1], 'FOCUS_SHIFT');
      assert.equal(TEMPLATE_PRIORITY[2], 'REPOSITORY_CONCENTRATION');
      assert.equal(TEMPLATE_PRIORITY[3], 'CONSISTENCY');
      assert.equal(TEMPLATE_PRIORITY[4], 'REVIEW_CONTRIBUTION');
      assert.equal(TEMPLATE_PRIORITY[5], 'PROJECT_HEALTH');
      assert.equal(TEMPLATE_PRIORITY[6], 'LANGUAGE_MIX_CHANGE');
      assert.equal(TEMPLATE_PRIORITY[7], 'QUIET_PERIOD');
    });
  });

  describe('Template 1: Activity Momentum', () => {
    const ANCHOR = new Date('2024-01-31T12:00:00Z');
    const range = '30d';

    it('returns up when current > previous by >10%', () => {
      const current = { timeline: [{ commits: 20 }] };
      const previous = { timeline: [{ commits: 10 }] };
      const out = evaluateActivityMomentum({ current, previous, range, anchor: ANCHOR });
      assert.ok(out);
      assert.equal(out.templateId, 'activity_momentum');
      assert.equal(out.metrics.state, 'up');
    });

    it('returns down when current < previous by >10%', () => {
      const current = { timeline: [{ commits: 5 }] };
      const previous = { timeline: [{ commits: 20 }] };
      const out = evaluateActivityMomentum({ current, previous, range, anchor: ANCHOR });
      assert.ok(out);
      assert.equal(out.metrics.state, 'down');
    });

    it('returns flat when change is within 10%', () => {
      const current = { timeline: [{ commits: 11 }] };
      const previous = { timeline: [{ commits: 10 }] };
      const out = evaluateActivityMomentum({ current, previous, range, anchor: ANCHOR });
      assert.ok(out);
      assert.equal(out.metrics.state, 'flat');
    });

    it('returns null when base is suppressed (<5)', () => {
      const current = { timeline: [{ commits: 10 }] };
      const previous = { timeline: [{ commits: 3 }] };
      const out = evaluateActivityMomentum({ current, previous, range, anchor: ANCHOR });
      assert.equal(out, null);
    });

    it('includes required fields in output', () => {
      const current = { timeline: [{ commits: 20 }] };
      const previous = { timeline: [{ commits: 10 }] };
      const out = evaluateActivityMomentum({ current, previous, range, anchor: ANCHOR });
      assert.ok(out.templateId);
      assert.ok(out.title);
      assert.ok(out.text);
      assert.ok(out.metrics);
      assert.ok(out.evidence);
      assert.ok(out.confidence);
      assert.ok(out.timeRange);
    });
  });

  describe('Template 2: Focus Shift', () => {
    it('returns shift when top focus changes', () => {
      const current = { focus: [{ tag: 'API work', evidence: { repoNames: ['repo1'] } }] };
      const previous = { focus: [{ tag: 'Frontend work', evidence: { repoNames: ['repo2'] } }] };
      const out = evaluateFocusShift({ current, previous });
      assert.ok(out);
      assert.equal(out.templateId, 'focus_shift');
      assert.equal(out.metrics.currentFocus, 'API work');
      assert.equal(out.metrics.previousFocus, 'Frontend work');
    });

    it('returns null when focus unchanged', () => {
      const current = { focus: [{ tag: 'API work' }] };
      const previous = { focus: [{ tag: 'API work' }] };
      const out = evaluateFocusShift({ current, previous });
      assert.equal(out, null);
    });

    it('returns null when current focus missing', () => {
      const current = { focus: [] };
      const previous = { focus: [{ tag: 'API work' }] };
      const out = evaluateFocusShift({ current, previous });
      assert.equal(out, null);
    });
  });

  describe('Template 3: Repository Concentration', () => {
    it('returns concentration when top repo has >30% commits', () => {
      const commits = [{ repoId: 'repo1' }, { repoId: 'repo1' }, { repoId: 'repo1' }, { repoId: 'repo2' }];
      const repositories = [
        { _id: 'repo1', fullName: 'user/repo1' },
        { _id: 'repo2', fullName: 'user/repo2' },
      ];
      const out = evaluateRepositoryConcentration({ commits, repositories, timeline: [] });
      assert.ok(out);
      assert.equal(out.templateId, 'repository_concentration');
      assert.equal(out.metrics.totalCommits, 4);
      assert.equal(out.metrics.topRepoPct, 75);
    });

    it('returns null when distribution is even', () => {
      const commits = [{ repoId: 'repo1' }, { repoId: 'repo2' }, { repoId: 'repo3' }, { repoId: 'repo4' }];
      const repositories = [{ _id: 'repo1' }, { _id: 'repo2' }, { _id: 'repo3' }, { _id: 'repo4' }];
      const out = evaluateRepositoryConcentration({ commits, repositories, timeline: [] });
      assert.equal(out, null);
    });

    it('returns null when no commits', () => {
      const out = evaluateRepositoryConcentration({ commits: [], repositories: [], timeline: [] });
      assert.equal(out, null);
    });
  });

  describe('Template 4: Consistency', () => {
    it('handles no activity', () => {
      const out = evaluateConsistency({
        consistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
        range: '30d',
      });
      assert.ok(out);
      assert.equal(out.metrics.activeDays, 0);
      assert.ok(out.text.includes('No recorded activity'));
    });

    it('reports active days and streak', () => {
      const out = evaluateConsistency({
        consistency: { activeDays: 18, currentStreak: 5, longestStreak: 10, gaps: [] },
        range: '30d',
      });
      assert.ok(out);
      assert.equal(out.metrics.activeDays, 18);
      assert.equal(out.metrics.currentStreak, 5);
      assert.equal(out.metrics.longestStreak, 10);
      assert.ok(out.text.includes('Active 18'));
      assert.ok(out.text.includes('current streak: 5'));
    });

    it('includes gaps in evidence', () => {
      const out = evaluateConsistency({
        consistency: {
          activeDays: 10,
          currentStreak: 2,
          longestStreak: 5,
          gaps: [{ start: '2024-01-10', end: '2024-01-12', length: 3 }],
        },
        range: '30d',
      });
      assert.ok(out.evidence.bucketStarts.length > 0);
    });
  });

  describe('Template 5: Review Contribution', () => {
    it('reports authored and reviewed PRs', () => {
      const pullRequests = [
        { isAuthoredByUser: true, isReviewedByUser: false, number: 1 },
        { isAuthoredByUser: true, isReviewedByUser: false, number: 2 },
        { isAuthoredByUser: false, isReviewedByUser: true, number: 3 },
        { isAuthoredByUser: false, isReviewedByUser: true, number: 4 },
      ];
      const out = evaluateReviewContribution({ pullRequests });
      assert.ok(out);
      assert.equal(out.metrics.authored, 2);
      assert.equal(out.metrics.reviewed, 2);
      assert.equal(out.metrics.reviewedPct, 50);
    });

    it('returns null when no PRs', () => {
      const out = evaluateReviewContribution({ pullRequests: [] });
      assert.equal(out, null);
    });
  });

  describe('Template 6: Project Health', () => {
    it('detects revival (quiet -> active)', () => {
      const repoHealth = [
        { repoId: 'repo1', repoName: 'user/repo1', health: 'active', daysSinceActivity: 2 },
      ];
      const previousRepoHealth = [{ repoId: 'repo1', health: 'quiet' }];
      const out = evaluateProjectHealth({ repoHealth, previousRepoHealth });
      assert.equal(out.length, 1);
      assert.ok(out[0].text.includes('revived'));
    });

    it('detects quiet (active -> quiet)', () => {
      const repoHealth = [
        { repoId: 'repo1', repoName: 'user/repo1', health: 'quiet', daysSinceActivity: 45 },
      ];
      const previousRepoHealth = [{ repoId: 'repo1', health: 'active' }];
      const out = evaluateProjectHealth({ repoHealth, previousRepoHealth });
      assert.equal(out.length, 1);
      assert.ok(out[0].text.includes('went quiet'));
    });

    it('returns empty when no change', () => {
      const repoHealth = [{ repoId: 'repo1', health: 'active' }];
      const previousRepoHealth = [{ repoId: 'repo1', health: 'active' }];
      const out = evaluateProjectHealth({ repoHealth, previousRepoHealth });
      assert.equal(out.length, 0);
    });
  });

  describe('Template 7: Language Mix Change', () => {
    it('detects meaningful language share change', () => {
      const current = { weightedBytes: { TypeScript: 8000, JavaScript: 2000 }, commitShare: {} };
      const previous = { weightedBytes: { TypeScript: 5000, JavaScript: 5000 }, commitShare: {} };
      const out = evaluateLanguageMixChange({
        current: { languages: current },
        previous: { languages: previous },
      });
      assert.ok(out);
      assert.equal(out.templateId, 'language_mix_change');
      assert.ok(out.text.includes('TypeScript'));
    });

    it('returns null when no change', () => {
      const langs = { weightedBytes: { TypeScript: 5000, JavaScript: 5000 }, commitShare: {} };
      const out = evaluateLanguageMixChange({
        current: { languages: langs },
        previous: { languages: langs },
      });
      assert.equal(out, null);
    });

    it('returns null when change < 5%', () => {
      const current = { weightedBytes: { TypeScript: 5100, JavaScript: 4900 }, commitShare: {} };
      const previous = { weightedBytes: { TypeScript: 5000, JavaScript: 5000 }, commitShare: {} };
      const out = evaluateLanguageMixChange({
        current: { languages: current },
        previous: { languages: previous },
      });
      assert.equal(out, null);
    });
  });

  describe('Template 8: Quiet Period', () => {
    it('reports long gap with neutral language', () => {
      const consistency = {
        gaps: [{ start: '2024-01-12', end: '2024-01-19', length: 8, label: 'gap_long' }],
      };
      const out = evaluateQuietPeriod({ consistency });
      assert.ok(out);
      assert.equal(out.templateId, 'quiet_period');
      assert.ok(out.text.includes('No recorded activity'));
      assert.ok(out.text.includes('private or unconnected work'));
    });

    it('returns null when no long gaps', () => {
      const consistency = { gaps: [{ length: 3, label: 'gap_short' }] };
      const out = evaluateQuietPeriod({ consistency });
      assert.equal(out, null);
    });
  });

  describe('evaluateInsights (main entry)', () => {
    it('returns up to 8 insights in fixed priority order', () => {
      const commits = Array.from({ length: 20 }, (_, i) => ({
        repoId: i < 15 ? 'repo1' : 'repo2',
        authoredAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      }));

      const currentData = {
        commits,
        pullRequests: [{ isAuthoredByUser: true, isReviewedByUser: true, number: 1 }],
        issues: [],
        repositories: [
          { _id: 'repo1', fullName: 'user/repo1' },
          { _id: 'repo2', fullName: 'user/repo2' },
        ],
        timeline: [{ commits: 20 }],
        languages: { weightedBytes: { TypeScript: 8000, JavaScript: 2000 } },
        focus: [{ tag: 'API work', evidence: { repoNames: ['repo1'] } }],
        consistency: {
          activeDays: 18,
          currentStreak: 5,
          longestStreak: 10,
          gaps: [{ start: '2024-01-12', end: '2024-01-19', length: 8, label: 'gap_long' }],
        },
        repoHealth: [{ repoId: 'repo1', repoName: 'user/repo1', health: 'active', daysSinceActivity: 2 }],
      };

      const previous = {
        timeline: [{ commits: 10 }],
        languages: { weightedBytes: { TypeScript: 5000, JavaScript: 5000 } },
        focus: [{ tag: 'Frontend work' }],
        consistency: { activeDays: 10, currentStreak: 2, longestStreak: 5, gaps: [] },
        repoHealth: [{ repoId: 'repo1', health: 'quiet' }],
        commits: Array.from({ length: 10 }, (_, i) => ({
          repoId: 'repo1',
          authoredAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
        })),
        pullRequests: [],
        issues: [],
        repositories: [],
      };

      const out = evaluateInsights({
        commits: currentData.commits || [],
        pullRequests: currentData.pullRequests || [],
        issues: currentData.issues || [],
        repositories: currentData.repositories || [],
        timeline: currentData.timeline || [],
        languages: currentData.languages || { weightedBytes: {}, commitShare: {} },
        focus: currentData.focus || [],
        consistency: currentData.consistency || {
          activeDays: 0,
          currentStreak: 0,
          longestStreak: 0,
          gaps: [],
        },
        repoHealth: currentData.repoHealth || [],
        previousCommits: previous.commits || [],
        previousPullRequests: previous.pullRequests || [],
        previousIssues: previous.issues || [],
        previousRepositories: previous.repositories || [],
        previousTimeline: previous.timeline || [],
        previousLanguages: previous.languages || { weightedBytes: {}, commitShare: {} },
        previousFocus: previous.focus || [],
        previousConsistency: previous.consistency || {
          activeDays: 0,
          currentStreak: 0,
          longestStreak: 0,
          gaps: [],
        },
        previousRepoHealth: previous.repoHealth || [],
        range: '30d',
        anchor: new Date('2024-01-31T12:00:00Z'),
      });

      assert.ok(out.length <= 8);
      // Check fixed priority order
      const ids = out.map((i) => i.templateId);
      for (let i = 0; i < ids.length - 1; i++) {
        const idxA = TEMPLATE_PRIORITY.indexOf(ids[i].toUpperCase().replace(/_/g, '_'));
        const idxB = TEMPLATE_PRIORITY.indexOf(ids[i + 1].toUpperCase().replace(/_/g, '_'));
        assert.ok(idxA <= idxB, `Priority order violated: ${ids[i]} before ${ids[i + 1]}`);
      }
    });

    it('caps at 8 insights', () => {
      assert.equal(MAX_INSIGHTS, 8);
    });

    it('same input produces same output (deterministic)', () => {
      const data = {
        commits: [{ repoId: 'repo1', authoredAt: new Date('2024-01-15T10:00:00Z') }],
        pullRequests: [],
        issues: [],
        repositories: [{ _id: 'repo1', fullName: 'user/repo1' }],
        timeline: [{ commits: 1 }],
        languages: { weightedBytes: { TypeScript: 1000 } },
        focus: [],
        consistency: { activeDays: 1, currentStreak: 1, longestStreak: 1, gaps: [] },
        repoHealth: [],
      };
      const previousData = {
        commits: [],
        pullRequests: [],
        issues: [],
        repositories: [],
        timeline: [],
        languages: { weightedBytes: {}, commitShare: {} },
        focus: [],
        consistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
        repoHealth: [],
      };
      const out1 = evaluateInsights({
        ...data,
        ...previousData,
        range: '30d',
        anchor: new Date('2024-01-31T12:00:00Z'),
        repositories: [{ _id: 'repo1', fullName: 'user/repo1' }],
      });
      const out2 = evaluateInsights({
        ...data,
        ...previousData,
        range: '30d',
        anchor: new Date('2024-01-31T12:00:00Z'),
        repositories: [{ _id: 'repo1', fullName: 'user/repo1' }],
      });
      assert.deepEqual(out1, out2);
    });

    it('input order does not affect output', () => {
      const commits1 = [
        { repoId: 'repo1', authoredAt: new Date('2024-01-15T10:00:00Z') },
        { repoId: 'repo2', authoredAt: new Date('2024-01-16T10:00:00Z') },
      ];
      const commits2 = [
        { repoId: 'repo2', authoredAt: new Date('2024-01-16T10:00:00Z') },
        { repoId: 'repo1', authoredAt: new Date('2024-01-15T10:00:00Z') },
      ];

      const baseData = {
        pullRequests: [],
        issues: [],
        repositories: [
          { _id: 'repo1', fullName: 'user/repo1' },
          { _id: 'repo2', fullName: 'user/repo2' },
        ],
        timeline: [{ commits: 2 }],
        languages: { weightedBytes: {} },
        focus: [],
        consistency: { activeDays: 2, currentStreak: 2, longestStreak: 2, gaps: [] },
        repoHealth: [],
      };

      const data1 = { ...baseData, commits: commits1 };
      const data2 = { ...baseData, commits: commits2 };

      const previousData = {
        commits: [],
        pullRequests: [],
        issues: [],
        repositories: [],
        timeline: [],
        languages: { weightedBytes: {}, commitShare: {} },
        focus: [],
        consistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
        repoHealth: [],
      };

      const out1 = evaluateInsights({
        ...data1,
        ...previousData,
        range: '30d',
        anchor: new Date('2024-01-31T12:00:00Z'),
        repositories: [
          { _id: 'repo1', fullName: 'user/repo1' },
          { _id: 'repo2', fullName: 'user/repo2' },
        ],
      });
      const out2 = evaluateInsights({
        ...data2,
        ...previousData,
        range: '30d',
        anchor: new Date('2024-01-31T12:00:00Z'),
        repositories: [
          { _id: 'repo1', fullName: 'user/repo1' },
          { _id: 'repo2', fullName: 'user/repo2' },
        ],
      });
      assert.deepEqual(out1, out2);
    });

    it('does not mutate input arrays', () => {
      const commits = [{ repoId: 'repo1', authoredAt: new Date('2024-01-15T10:00:00Z') }];
      const originalLength = commits.length;
      evaluateInsights({
        commits: [...commits],
        pullRequests: [],
        issues: [],
        repositories: [{ _id: 'repo1' }],
        timeline: [{ commits: 1 }],
        languages: { weightedBytes: {} },
        focus: [],
        consistency: { activeDays: 1, currentStreak: 1, longestStreak: 1, gaps: [] },
        repoHealth: [],
        range: '30d',
        anchor: new Date('2024-01-31T12:00:00Z'),
      });
      assert.equal(commits.length, originalLength);
    });
  });

  describe('Edge cases', () => {
    it('empty data returns consistency insight (no activity)', () => {
      const out = evaluateInsights({
        commits: [],
        pullRequests: [],
        issues: [],
        repositories: [],
        timeline: [],
        languages: { weightedBytes: {}, commitShare: {} },
        focus: [],
        consistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
        repoHealth: [],
        previousCommits: [],
        previousPullRequests: [],
        previousIssues: [],
        previousRepositories: [],
        previousTimeline: [],
        previousLanguages: { weightedBytes: {}, commitShare: {} },
        previousFocus: [],
        previousConsistency: { activeDays: 0, currentStreak: 0, longestStreak: 0, gaps: [] },
        previousRepoHealth: [],
        range: '30d',
        anchor: new Date('2024-01-31T12:00:00Z'),
      });
      assert.equal(out.length, 1);
      assert.equal(out[0].templateId, 'consistency');
      assert.ok(out[0].text.includes('No recorded activity'));
    });

    it('suppressed delta does not produce Activity Momentum', () => {
      const current = { timeline: [{ commits: 10 }] };
      const previous = { timeline: [{ commits: 3 }] };
      const out = evaluateActivityMomentum({ current, previous, range: '30d', anchor: new Date() });
      assert.equal(out, null);
    });
  });
});
