import { useSearchParams } from 'react-router-dom';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';

/**
 * Login page (tasks.md T1.1). "Connect with GitHub" starts the OAuth flow at
 * `/api/auth/github`; error states from the callback are rendered inline.
 * Error values: `denied` (user revoked), `state` (expired/invalid),
 * `exchange_failed` (token exchange or user lookup failed),
 * `db_unavailable` (login could not be saved to the database).
 */
const OAUTH_ERRORS = {
  denied: {
    title: 'GitHub connection not completed',
    body: 'You cancelled the GitHub sign-in. Click below to try again.',
  },
  state: {
    title: 'Sign-in link expired',
    body: 'The sign-in link is no longer valid. Click below to start a fresh connection.',
  },
  exchange_failed: {
    title: 'Could not connect to GitHub',
    body: 'The connection did not complete. Check your GitHub OAuth App configuration and try again.',
  },
  db_unavailable: {
    title: 'We could not save your connection',
    body: 'The sign-in was approved but could not be saved. Click below to try again.',
  },
};

export default function Login() {
  const [params] = useSearchParams();
  const errorKey = params.get('error');
  const error = errorKey ? (OAUTH_ERRORS[errorKey] ?? OAUTH_ERRORS.exchange_failed) : null;

  return (
    <main className="mx-auto flex max-w-narrow flex-col gap-24 pt-48">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-text">Frieday</h1>
        <p className="mt-8 text-sm text-text2">Frieday understands how you build software.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-danger bg-dangerBg p-16">
          <div className="flex items-center gap-8">
            <h2 className="text-base font-semibold text-danger">{error.title}</h2>
            <Badge tone="danger">GitHub error</Badge>
          </div>
          <p className="mt-8 text-sm text-text2">{error.body}</p>
        </div>
      )}

      <Card title="Sign in">
        <p className="text-sm text-text2">
          Connect your GitHub account to sync repositories, commits, pull requests, and issues.
        </p>
        <p className="mt-8 text-xs text-text3">
          Scope: <span className="mono">read:user repo</span> — needed to include private repositories you can
          access. Your token is stored encrypted on the server and never sent to the browser.
        </p>
        <div className="mt-16">
          {/* Real document navigation (not a router Link) so the browser
              follows the server 302 to GitHub. Uses location.replace so the
              login page does not linger in history: after the OAuth callback
              redirects to /dashboard, Browser Back must not return to a login
              page that immediately bounces back to the dashboard. */}
          <button
            type="button"
            onClick={() => window.location.replace('/api/auth/github')}
            className="inline-flex h-44 items-center justify-center rounded-sm bg-accent px-24 text-base font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Connect with GitHub
          </button>
        </div>
      </Card>
    </main>
  );
}
