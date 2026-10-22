import { Link } from 'react-router-dom';

/**
 * Terms of Service.
 *
 * Public route — no GitHub authentication required. Built from verified
 * implementation facts; operator-specific fields (entity name, contact,
 * jurisdiction) are left as owner-configurable placeholders so no unsupported
 * legal claim is published.
 *
 * Route: /terms
 */
export default function Terms() {
  return (
    <main className="flex min-h-screen flex-col bg-bg text-text">
      <nav className="flex items-center gap-16 border-b border-border bg-surface px-16 sm:px-24">
        <Link to="/" className="text-base font-bold tracking-tight text-text">
          Frieday
        </Link>
        <Link
          to="/privacy"
          className="text-sm font-medium text-text2 hover:text-accent underline-offset-2 hover:underline"
        >
          Privacy Policy
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
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">Terms of Service</h1>
        <p className="mt-8 text-sm text-text2 max-w-xl">
          Last updated: <span className="font-medium">Owner decision — set the effective date.</span>
        </p>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">1. Acceptance of terms</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            By accessing or using Frieday (the &ldquo;service&rdquo;), you agree to be bound by these Terms of
            Service. If you do not agree, you may not use the service.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            The service connects to GitHub using OAuth. By clicking &ldquo;Continue with GitHub&rdquo; you
            authorize Frieday to access your GitHub account using the scopes disclosed on the{' '}
            <Link to="/github-data">GitHub Data &amp; Permissions</Link> page.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">2. Eligibility</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            You must be at least 13 years old to use the service. By using the service you represent that you
            meet this age requirement and that you have the authority to connect the GitHub account you
            authorize.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">3. GitHub account connection and authorization</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Frieday uses GitHub OAuth to authenticate you and, with your consent, to read data from your
            GitHub account. The OAuth scopes requested are
            <code className="mono text-sm">read:user</code> and
            <code className="mono text-sm">repo</code>.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            The <code className="mono text-sm">repo</code> scope can authorize access to private repository
            information that is available to your GitHub user account, subject to GitHub&rsquo;s permission
            model and Frieday&rsquo;s actual API usage. See the
            <Link to="/github-data">GitHub Data &amp; Permissions</Link> page for exactly what Frieday fetches
            and stores.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Your GitHub access token is encrypted at rest and never transmitted to your browser. It is held in
            server memory only for the duration of a sync. You may disconnect your GitHub account at any time
            from the Settings page; disconnecting revokes Frieday&rsquo;s GitHub grant and clears the stored
            token, but does not delete previously synced data unless you also use &ldquo;Delete all
            data.&rdquo;
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">4. Your responsibility</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            You are responsible for maintaining the security of your GitHub account and for the repository
            permissions you grant. You are responsible for all activity that occurs under your connected
            GitHub account while the Frieday integration is active.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            You may only connect GitHub accounts that you own or are authorized to administer. Do not connect
            accounts belonging to an employer or organization unless you have permission to do so.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">5. Permitted and prohibited use</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            You may use the service to view analysis of your own GitHub repository, commit, pull request,
            issue, and language activity.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">You may not use the service to:</p>
          <ul className="mt-8 list-disc pl-24 text-sm text-text2 leading-relaxed space-y-4">
            <li>Access GitHub accounts or repositories you are not authorized to access;</li>
            <li>
              Reverse-engineer, scrape, or otherwise attempt to extract the service&rsquo;s underlying source
              code or algorithms;
            </li>
            <li>
              Use the service in a manner that exceeds GitHub&rsquo;s API rate limits or abuse policies;
            </li>
            <li>Store or transmit data through the service that violates applicable law.</li>
          </ul>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">6. Service availability and changes</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Frieday is provided on an &ldquo;as is&rdquo; basis. The service may be changed, suspended, or
            discontinued at any time without notice. We do not guarantee that the service will be error-free,
            uninterrupted, or secure.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            These terms may be updated from time to time. Your continued use of the service after changes are
            posted constitutes acceptance of the revised terms.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">7. Third-party services</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            The service integrates with GitHub. Your use of GitHub is subject to GitHub&rsquo;s own Terms of
            Service and Privacy Policy, which are separate from these terms. Frieday is not sponsored,
            endorsed, or administered by GitHub.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">8. Intellectual property</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            As between you and Frieday, you retain all ownership of your code, repositories, commits, issues,
            and pull requests. Frieday does not claim any ownership interest in your GitHub data.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            The Frieday name, logo, and service interface are the property of
            <span className="font-medium">Owner decision — legal entity name.</span>
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">9. Warranty and liability limitations</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            The service is provided without warranties of any kind, express or implied, to the fullest extent
            permitted by applicable law.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            To the fullest extent permitted by applicable law, Frieday and its operators are not liable for
            any indirect, incidental, special, consequential, or punitive damages, or for any loss of data,
            use, goodwill, or profits, arising out of or related to your use of the service.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">10. Account suspension and termination</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Frieday may suspend or terminate your access to the service at its discretion, including for
            violation of these terms. Upon termination, your right to use the service ends immediately.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            You may stop using the service at any time. Disconnecting your GitHub account revokes
            Frieday&rsquo;s access; deleting your account data (Settings &rarr; Delete all data) permanently
            removes all synced and derived records.
          </p>
        </section>

        <section className="mt-32">
          <h2 className="text-lg font-semibold text-text">11. Governing law and contact</h2>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            These terms are governed by the laws of
            <span className="font-medium">Owner decision — jurisdiction.</span>, without regard to
            conflict-of-law principles.
          </p>
          <p className="mt-8 text-sm text-text2 leading-relaxed">
            Questions about these terms may be directed to
            <span className="font-medium">Owner decision — contact email.</span>
          </p>
        </section>
      </div>
    </main>
  );
}
