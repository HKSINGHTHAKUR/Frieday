import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import RepoDetail from './RepoDetail.jsx';
import { TestProviders, API_FIXTURES } from '../test/helpers.jsx';

// Isolated data-passthrough test: mock ActivityChart to record the buckets
// prop so we can prove the API miniTimeline reaches the chart unchanged and
// no bars are fabricated. Kept separate from RepoDetail.test.jsx so that file
// continues rendering the real ActivityChart.
const bucketsSpy = vi.fn();

vi.mock('../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock('../components/charts/ActivityChart.jsx', () => ({
  default: ({ buckets }) => {
    bucketsSpy(buckets);
    return <div data-testid="activity-chart" />;
  },
}));
import { apiGet } from '../lib/apiClient.js';

const REPO_ID = '64b64b64b64b64b64b64b64b';
const DETAIL = {
  ...API_FIXTURES.repoItem,
  miniTimeline: [
    { bucketStart: '2026-09-01T00:00:00Z', commits: 1, prsOpened: 0, prsMerged: 0, issuesTouched: 0 },
    { bucketStart: '2026-09-02T00:00:00Z', commits: 3, prsOpened: 1, prsMerged: 0, issuesTouched: 0 },
    { bucketStart: '2026-09-03T00:00:00Z', commits: 0, prsOpened: 0, prsMerged: 2, issuesTouched: 0 },
  ],
};

function renderDetail(range) {
  return render(
    <TestProviders initialEntries={[`/repositories/${REPO_ID}?range=${range}`]}>
      <Routes>
        <Route path="/repositories/:id" element={<RepoDetail />} />
      </Routes>
    </TestProviders>
  );
}

describe('RepoDetail activity chart data passthrough', () => {
  beforeEach(() => {
    apiGet.mockReset();
    bucketsSpy.mockReset();
  });

  it.each(['30d', '90d', '12m'])(
    'passes the API miniTimeline to the activity chart unchanged for %s',
    async (range) => {
      apiGet.mockResolvedValue(DETAIL);
      renderDetail(range);
      await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/api/repos/${REPO_ID}?range=${range}`));
      await waitFor(() => expect(bucketsSpy).toHaveBeenCalled());
      expect(bucketsSpy).toHaveBeenLastCalledWith(DETAIL.miniTimeline);
    }
  );
});
