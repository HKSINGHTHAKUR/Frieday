import { Link } from 'react-router-dom';

/**
 * Privacy Policy.
 *
 * Public route — no GitHub authentication required. Built from verified
 * implementation facts; operator-specific fields (entity name, contact,
 * jurisdiction) are left as owner-configurable placeholders so no unsupported
 * legal claim is published.
 *
 * Route: /privacy
 */
export default function Privacy() {
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
          to="/github-data"
          className="text-sm font-medium text-text2 hover:text-accent underline-offset-2 hover:underline"
        >
          GitHub Data & Permissions
        </Link>
        <div className="ml-auto" />
        <Link to="/login" className="text-sm font-medium text-accent underline-offset-2 hover:underline">
          Sign in
        </Link>
      </nav>

      <div className="mx-auto w-full min-w-0 max-w-prose px-16 sm:px-24 py-24 sm:py-32">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">Privacy Policy</h1>
        <p className="mt-8 text-sm text-text2 max-w-xl">
          Last updated: <span className="font-medium">Owner decision — set the effective date.</span>
        </p>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">1. Introduction</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            This Privacy Policy describes how Frieday collects, uses, stores, and protects your information
            when you connect your GitHub account. It applies to the Frieday service accessed at
            <span className="font-medium">https://frieday.onrender.com</span>.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Frieday is not sponsored, endorsed, or administered by GitHub. Your use of GitHub is also subject
            to GitHub&rsquo;s own Privacy Policy.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">2. Information we collect</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Directly from you:</strong> Frieday does not collect a separate
            registration form, email address, or password. Your account is identified solely by your connected
            GitHub account.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">From GitHub (with your authorization):</strong>
            When you authorize Frieday via GitHub OAuth (<code className="mono text-sm">read:user</code> and
            <code className="mono text-sm">repo</code> scopes), Frieday receives your GitHub profile and
            repository data through GitHub&rsquo;s API:
          </p>
          <ul className="mt-8 list-disc pl-24 text-sm text-text2 leading-relaxed space-y-4">
            <li>
              <strong>Profile:</strong> GitHub user ID, login (username), avatar URL, and profile URL.
            </li>
            <li>
              <strong>Repositories:</strong> repository names, full names, visibility (public/private),
              description, primary language, stars, fork status, default branch, topics, license, URLs, and
              pushed/updated timestamps.
            </li>
            <li>
              <strong>Commits:</strong> commit SHAs, messages (headline and full), author and committer
              names/IDs/avatar URLs, authored and committed timestamps, addition/deletion statistics, changed
              filenames, and parent SHAs.
            </li>
            <li>
              <strong>Issues:</strong> issue numbers, titles, bodies, states, labels, assignees, authors,
              milestones, and timestamps.
            </li>
            <li>
              <strong>Pull requests:</strong> PR numbers, titles, bodies, states, authors,
              additions/deletions, changed files, review data, merge status, and timestamps.
            </li>
            <li>
              <strong>Languages:</strong> bytes per programming language for each repository.
            </li>
          </ul>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            The <code className="mono text-sm">repo</code> scope can authorize access to{' '}
            <strong>private repository information</strong> that is available to your GitHub user account,
            subject to GitHub&rsquo;s permission model and Frieday&rsquo;s actual API usage. Frieday does not
            distinguish between public and private data at collection time; it fetches whatever the authorized
            token permits.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">3. How your information is used</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Frieday processes your GitHub data to provide the service — namely, to analyze and present your
            repository, commit, pull request, issue, and language activity through dashboards, timelines, and
            insights. Each category is used as follows:
          </p>
          <ul className="mt-8 list-disc pl-24 text-sm text-text2 leading-relaxed space-y-4">
            <li>
              <strong>Profile data</strong> — to identify your account and display your GitHub login and
              avatar.
            </li>
            <li>
              <strong>Repository data</strong> — to list your repositories and show activity summaries.
            </li>
            <li>
              <strong>Commit data</strong> — to compute activity trends, commit counts, and change statistics.
            </li>
            <li>
              <strong>Issue and PR data</strong> — to show open/closed counts, merge activity, and
              contribution patterns.
            </li>
            <li>
              <strong>Language data</strong> — to show the distribution of programming languages across your
              repositories.
            </li>
          </ul>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Derived data (activity buckets and computed insights) is generated from your synced data to power
            the dashboard and is stored alongside the raw data described below.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">4. Data storage and protection</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Where data is stored:</strong> Synced GitHub data and derived
            insights are persisted in a MongoDB database operated by the service operator. Each record is
            scoped to your GitHub user ID so that one user&rsquo;s data is never commingled with
            another&rsquo;s.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">GitHub access token:</strong> Your GitHub OAuth access token is
            encrypted at rest using AES-256-GCM (key held in server configuration,{' '}
            <code className="mono text-sm">TOKEN_ENC_KEY</code>). The raw token is never written to logs,
            never sent to your browser, and never persisted unencrypted. It is decrypted in server memory only
            for the duration of a sync and is not retained in memory afterward.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Who can access it:</strong> Application services running on the same
            backend can access your stored data in order to render the service. No third-party analytics or
            advertising services receive your data. Your data is not sold, rented, or shared with third
            parties.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Server logs:</strong> The backend writes structured JSON logs
            (pino). Logs contain request identifiers and safe operation metadata only — never tokens, secrets,
            cookies, or your GitHub data.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">5. OAuth token handling and limits of access</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            When you sign in, Frieday exchanges a short-lived authorization code for a GitHub access token
            server-side. The token never reaches your browser. Frieday uses the token only to fetch the GitHub
            data listed in Section 2, scoped by the
            <code className="mono text-sm">read:user</code> and
            <code className="mono text-sm">repo</code> scopes you authorized.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Frieday does not use your token for purposes unrelated to the service, and does not sell GitHub
            data. If Frieday ever wishes to use your data for a new purpose, it will update this Privacy
            Policy and obtain your consent where required.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">6. Data retention and deletion</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Synced GitHub data and derived insights are retained until you take action to remove them. There
            is no automatic expiration or retention period implemented in the current version of the service.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Disconnect GitHub:</strong> Revokes Frieday&rsquo;s GitHub OAuth
            grant (best-effort) and clears the stored access token. You remain signed in to Frieday. Your
            synced data <strong>is not deleted</strong> by disconnecting; it is kept until you delete it.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Delete all data:</strong> Permanently deletes all synced and derived
            records tied to your account — repositories, commits, pull requests, issues, languages, activity
            buckets, insights, and sync state — and removes your user document. This cannot be undone;
            reconnecting later starts from scratch.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            After disconnection, GitHub can no longer provide new data to Frieday, but already-stored data
            remains until you delete it.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">7. Third-party processors</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">GitHub:</strong> Authentication and data are handled through
            GitHub&rsquo;s OAuth and API. GitHub&rsquo;s own Privacy Policy applies to GitHub&rsquo;s
            processing of your data. Frieday is not responsible for GitHub&rsquo;s privacy practices.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Hosting:</strong> The service is hosted on{' '}
            <span className="font-medium">Render</span> (inferred from the onrender.com production domain;
            confirm in your deployment configuration).
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">AI:</strong> Optional AI explanations are disabled by default (
            <code className="mono text-sm">AI_ENABLED=false</code>). When enabled, an explanation request may
            be sent to an LLM provider configured by the operator (
            <code className="mono text-sm">AI_PROVIDER</code>, <code className="mono text-sm">AI_MODEL</code>,
            <code className="mono text-sm">AI_BASE_URL</code>). No AI request is made when the setting is off,
            and AI only explains pre-computed insights — it never calculates new data or accesses raw commit
            content. Confirm in your production environment whether AI explanations are enabled and which
            provider and model are configured.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">8. Cookies, sessions, and analytics</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Session cookies:</strong> After sign-in, Frieday sets two httpOnly
            cookies:
            <code className="mono text-sm">fd_access</code> (15 minutes) and
            <code className="mono text-sm">fd_refresh</code> (7-day sliding rotation). These cookies are not
            accessible by JavaScript and are used only to maintain your session. They are cleared when you
            sign out or delete your data.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">OAuth state cookie:</strong> During sign-in, a single-use, signed,
            httpOnly state cookie (<code className="mono text-sm">fd_oauth_state</code>) protects against
            cross-site request forgery. It expires after 10 minutes and is cleared after the callback.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            <strong className="text-text">Analytics:</strong> The current version of the service does not load
            third-party analytics or tracking scripts.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">9. Your rights</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">You may:</p>
          <ul className="mt-8 list-disc pl-24 text-sm text-text2 leading-relaxed space-y-4">
            <li>View your connected GitHub account and granted scopes in Settings;</li>
            <li>
              Disconnect your GitHub account at any time (revokes the OAuth grant and clears the stored
              token);
            </li>
            <li>Delete all synced and derived data at any time via Settings &rarr; Delete all data;</li>
            <li>
              Request access to, correction of, or deletion of your personal data by contacting{' '}
              <span className="font-medium">Owner decision — privacy contact email.</span>;
            </li>
            <li>Withdraw consent by disconnecting GitHub and deleting your data.</li>
          </ul>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">10. Policy updates</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Frieday may update this Privacy Policy from time to time. The &ldquo;Last updated&rdquo; date at
            the top of this page reflects the most recent revision. Your continued use of the service after
            changes are posted constitutes acceptance of the revised policy.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">11. Contact</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Privacy questions or requests may be directed to
            <span className="font-medium">Owner decision — privacy contact email.</span>
          </p>
        </section>
      </div>
    </main>
  );
}
