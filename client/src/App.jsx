import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import Button from './components/ui/Button.jsx';
import Card from './components/ui/Card.jsx';
import PageShell from './components/layout/PageShell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Timeline from './pages/Timeline.jsx';
import Repositories from './pages/Repositories.jsx';
import RepoDetail from './pages/RepoDetail.jsx';
import Insights from './pages/Insights.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Terms from './pages/Terms.jsx';
import Privacy from './pages/Privacy.jsx';
import GitHubData from './pages/GitHubData.jsx';
import { AuthProvider } from './store/AuthStore.jsx';
import { SyncProvider } from './store/SyncStore.jsx';
import { ToastProvider } from './store/ToastStore.jsx';
import { useAuth } from './hooks/useAuth.js';
import { buildLoginUrl, readReturnDestination } from './lib/returnDestination.js';

/**
 * Router + layout + auth gate (tasks.md T1.3).
 *
 * - `loading`: full-screen probe screen — the app shell is NEVER rendered
 *   before the session is known, so an unauthenticated user cannot flicker
 *   through the dashboard.
 * - `error` (network/server): full-page retry card — NOT treated as session
 *   loss (prd.md §20: full-page error only on auth/session loss).
 * - `unauthenticated`: every app route redirects to /login; /login is the
 *   reconnect prompt.
 * - `authenticated`: app shell with global sync + toast providers; /login
 *   bounces back to the app.
 */
export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { status, revalidating } = useAuth();

  if (status === 'loading' || revalidating) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <div className="w-narrow flex flex-col gap-16 text-center">
          <p className="text-2xl font-bold text-text">Frieday</p>
          <div className="skeleton-pulse h-16 rounded-md bg-surface2" aria-hidden="true" />
          <p className="text-sm text-text3" role="status">
            Checking your session…
          </p>
        </div>
      </main>
    );
  }

  if (status === 'error') {
    return <SessionErrorScreen />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />
      {/* Public legal pages — no GitHub authentication required, and they must
          not initiate OAuth or redirect to /login. Placed before the catch-all
          auth gate so they match first. */}
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/github-data" element={<GitHubData />} />
      <Route
        path="/*"
        element={
          status === 'unauthenticated' ? (
            <UnauthenticatedRedirect />
          ) : (
            <ToastProvider>
              <SyncProvider>
                <PageShell>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    {/* The OAuth callback lands here (architecture.md §7). */}
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/timeline" element={<Timeline />} />
                    <Route path="/repositories" element={<Repositories />} />
                    <Route path="/repositories/:id" element={<RepoDetail />} />
                    <Route path="/insights" element={<Insights />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </PageShell>
              </SyncProvider>
            </ToastProvider>
          )
        }
      />
    </Routes>
  );
}

/**
 * Sends an unauthenticated visitor to the login page, carrying the route they
 * were trying to reach so the sign-in can return them to it.
 *
 * The redirect REPLACES the history entry: keeping the protected route would
 * leave it in the back stack, and Back would then re-enter it (the app would
 * redirect to login again, so the user would ping-pong between the two).
 */
function UnauthenticatedRedirect() {
  const location = useLocation();
  const target = buildLoginUrl(location.pathname + location.search);
  return <Navigate to={target} replace />;
}

/**
 * The login route.
 *
 * A user who already has a valid session is sent on to the app. The redirect
 * REPLACES the history entry so the login page is not left behind as a
 * redundant step in the back stack (and so Back cannot return to it and
 * bounce forward again).
 */
function LoginGate() {
  const { status } = useAuth();
  const [searchParams] = useSearchParams();
  if (status === 'authenticated') {
    const destination = readReturnDestination(`?${searchParams.toString()}`);
    return <Navigate to={destination} replace />;
  }
  return <Login />;
}

/** Non-auth /me failure (network, 5xx): retryable, no session assumption. */
function SessionErrorScreen() {
  const { error, loadMe } = useAuth();
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-24">
      <Card title="We could not reach your session" className="w-narrow text-left">
        <p className="text-sm text-text2">{error}</p>
        <div className="mt-16">
          <Button variant="primary" onClick={() => loadMe()}>
            Try again
          </Button>
        </div>
      </Card>
    </main>
  );
}
