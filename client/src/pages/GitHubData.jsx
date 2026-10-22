import { Link } from 'react-router-dom';

/**
 * GitHub Data & Permissions.
 *
 * Explains exactly which OAuth scopes Frieday requests, what they enable, what
 * Frieday actually fetches and stores, and how users can disconnect or revoke
 * authorization. Built from verified implementation facts; no claim is made
 * that Frieday accesses only public data — the `repo` scope can authorize
 * access to private repository information available to the user.
 *
 * Public route — no GitHub authentication required.
 *
 * Route: /github-data
 */
export default function GitHubData() {
  return (
    <main className="flex min-h-screen flex-col bg-bg text-text">
      <nav className="flex items-center gap-16 border-b border-border bg-surface px-16 sm:px-24">
        <Link to="/" className="text-base font-bold tracking-tight text-text">
          Frieday
        </Link>
        <Link
          to="/terms"
          className="text-sm font-medium text-text2 hover:text-accent underline-offset-2 hover:underline"
        >
          Terms of Service
        </Link>
        <Link
          to="/privacy"
          className="text-sm font-medium text-text2 hover:text-accent underline-offset-2 hover:underline"
        >
          Privacy Policy
        </Link>
        <div className="ml-auto" />
        <Link to="/login" className="text-sm font-medium text-accent underline-offset-2 hover:underline">
          Sign in
        </Link>
      </nav>

      <div className="mx-auto w-full min-w-0 max-w-prose px-16 sm:px-24 py-24 sm:py-32">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">GitHub Data & Permissions</h1>
        <p className="mt-8 text-sm text-text2 max-w-xl">
          What Frieday requests from GitHub, what it actually fetches and stores, and how you can disconnect.
        </p>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">1. OAuth scopes requested</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            When you sign in with GitHub, Frieday redirects you to GitHub to authorize the following OAuth
            scopes:
          </p>
          <table className="mt-16 w-full border-collapse text-left text-sm text-text2">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-8 font-medium text-text">Scope</th>
                <th className="pb-8 font-medium text-text">What it enables</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="pb-12 pt-12 font-medium text-text mono">read:user</td>
                <td className="pb-12 pt-12">
                  Read your GitHub profile: user ID, login, avatar, and profile URL.
                </td>
              </tr>
              <tr className="border-b border-border">
                <td className="pb-12 pt-12 font-medium text-text mono">repo</td>
                <td className="pb-12 pt-12">
                  Read repository data.{' '}
                  <strong className="text-text">
                    This scope can authorize access to private repository information that is available to
                    your GitHub user account, subject to GitHub&rsquo;s permission model and Frieday&rsquo;s
                    actual API usage.
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-16 text-sm text-text2 leading-relaxed">
            Frieday does not request additional scopes (for example,
            <code className="mono text-sm">write:repo</code> or
            <code className="mono text-sm">admin:org</code>) and does not seek permission to modify your
            repositories, create issues, or change settings on your behalf.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">2. What Frieday fetches from GitHub</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            After authorization, Frieday&rsquo;s server fetches the following data using your access token
            (server-side only — the token never reaches your browser):
          </p>
          <table className="mt-16 w-full border-collapse text-left text-sm text-text2">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-8 font-medium text-text">GitHub API endpoint</th>
                <th className="pb-8 font-medium text-text">Data retrieved</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="pb-12 pt-12 font-medium text-text mono">GET /user</td>
                <td className="pb-12 pt-12">GitHub user ID, login (username), avatar URL, profile URL.</td>
              </tr>
              <tr className="border-b border-border">
                <td className="pb-12 pt-12 font-medium text-text mono">GET /user/repos</td>
                <td className="pb-12 pt-12">
                  Repository names, full names, visibility (public/private), description, primary language,
                  stars, fork status, default branch, topics, license, HTML/clone/SSH URLs, and pushed /
                  updated timestamps.
                </td>
              </tr>
              <tr className="border-b border-border">
                <td className="pb-12 pt-12 font-medium text-text mono">
                  GET /repos&lbrace;owner&rbrace;/&lbrace;repo&rbrace;/commits
                </td>
                <td className="pb-12 pt-12">
                  Commit SHAs, messages, author/committer names, IDs, avatar URLs, timestamps,
                  addition/deletion statistics, changed filenames, and parent SHAs.
                </td>
              </tr>
              <tr className="border-b border-border">
                <td className="pb-12 pt-12 font-medium text-text mono">
                  GET /repos&lbrace;owner&rbrace;/&lbrace;repo&rbrace;/issues
                </td>
                <td className="pb-12 pt-12">
                  Issue numbers, titles, bodies, states, labels, assignees, authors, milestones, and
                  timestamps.
                </td>
              </tr>
              <tr className="border-b border-border">
                <td className="pb-12 pt-12 font-medium text-text mono">
                  GET /repos&lbrace;owner&rbrace;/&lbrace;repo&rbrace;/pulls
                </td>
                <td className="pb-12 pt-12">
                  Pull request numbers, titles, bodies, states, authors, additions/deletions, changed files,
                  review data, merge status, and timestamps.
                </td>
              </tr>
              <tr className="border-b border-border">
                <td className="pb-12 pt-12 font-medium text-text mono">
                  GET /repos&lbrace;owner&rbrace;/&lbrace;repo&rbrace;/languages
                </td>
                <td className="pb-12 pt-12">Bytes per programming language for each repository.</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-16 text-sm text-text2 leading-relaxed">
            Data is fetched with pagination and per-resource caps (for example, up to 100 repositories and 500
            commits per repository by default, configurable by the operator). All fetches happen server-side
            using your encrypted access token.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">3. What Frieday stores</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Frieday persists your synced GitHub data and derived insights in a MongoDB database, scoped to
            your GitHub user ID. Stored data includes:
          </p>
          <ul className="mt-8 list-disc pl-24 text-sm text-text2 leading-relaxed space-y-4">
            <li>
              <strong>Account:</strong> GitHub user ID, login, avatar URL, profile URL, granted scopes, and
              last-synced timestamp.
            </li>
            <li>
              <strong>Repositories:</strong> the repository metadata listed above.
            </li>
            <li>
              <strong>Commits:</strong> commit SHAs, messages, author/committer details, statistics, and
              changed filenames.
            </li>
            <li>
              <strong>Issues and pull requests:</strong> the issue/PR fields listed above.
            </li>
            <li>
              <strong>Languages:</strong> bytes per language per repository.
            </li>
            <li>
              <strong>Derived data:</strong> pre-computed activity buckets (commit counts, PR counts, issue
              counts over time) and generated insights (titles, summaries, metrics, evidence references).
            </li>
          </ul>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Your GitHub access token is <strong>not</strong> stored in plain text. It is encrypted at rest
            using AES-256-GCM (a key held in server configuration) and decrypted in memory only during a sync.
            The token never reaches your browser and is never logged.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">4. Limits on how Frieday uses your data</h2>
          <ul className="mt-8 list-disc pl-24 text-sm text-text2 leading-relaxed space-y-4">
            <li>
              Frieday uses your GitHub data only to provide the service (dashboards, timelines, insights). It
              does not sell, rent, or share your data with third parties.
            </li>
            <li>
              Frieday does not use your token for purposes unrelated to the service. Any future new purpose
              would be disclosed in an updated Privacy Policy.
            </li>
            <li>
              Because the <code className="mono text-sm">repo</code> scope can authorize access to private
              repository information, Frieday treats all fetched data — public and private — as user data
              subject to this page and the Privacy Policy.
            </li>
          </ul>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">5. Disconnecting and revoking authorization</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            You can sever Frieday&rsquo;s access to your GitHub account at any time from the Settings page:
          </p>
          <ol className="mt-8 list-decimal pl-24 text-sm text-text2 leading-relaxed space-y-4">
            <li>Open Settings.</li>
            <li>Click &ldquo;Disconnect GitHub.&rdquo;</li>
            <li>Confirm in the dialog.</li>
          </ol>
          <p className="mt-12 text-sm text-text2 leading-relaxed">Disconnecting:</p>
          <ul className="mt-8 list-disc pl-24 text-sm text-text2 leading-relaxed space-y-4">
            <li>
              Sends a revocation request to GitHub (
              <code className="mono text-sm">DELETE /applications/:id/grant</code>) on a best-effort basis. If
              GitHub cannot be reached, the disconnection still completes locally.
            </li>
            <li>Clears Frieday&rsquo;s stored encrypted access token so it can never be used again.</li>
            <li>Keeps you signed in to Frieday — only the GitHub integration is severed.</li>
          </ul>
          <p className="mt-16 text-sm text-text2 leading-relaxed">
            <strong className="text-text">What happens to stored data:</strong>
            Disconnecting does <strong>not</strong> delete data Frieday has already synced. Your repositories,
            commits, and derived insights remain in Frieday&rsquo;s database until you explicitly delete them
            via Settings &rarr; &ldquo;Delete all data,&rdquo; which permanently removes all synced and
            derived records and your user document.
          </p>
          <p className="mt-16 text-sm text-text2 leading-relaxed">
            You can also revoke Frieday&rsquo;s access directly from your GitHub account settings under
            &ldquo;Authorized OAuth Apps.&rdquo;
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">6. GitHub&rsquo;s separate terms</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Your use of GitHub&rsquo;s API and OAuth is subject to GitHub&rsquo;s own Terms of Service and
            Privacy Policy. Frieday is not sponsored, endorsed, or administered by GitHub.
          </p>
        </section>
      </div>
    </main>
  );
}
