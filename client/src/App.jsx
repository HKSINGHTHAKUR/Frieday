import { Navigate, Route, Routes } from 'react-router-dom';
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
import { AuthProvider } from './store/AuthStore.jsx';
import { SyncProvider } from './store/SyncStore.jsx';
import { ToastProvider } from './store/ToastStore.jsx';
import { useAuth } from './hooks/useAuth.js';

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
  const { status } = useAuth();

  if (status === 'loading') {
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
      <Route
        path="/*"
        element={
          status === 'unauthenticated' ? (
            <Navigate to="/login" replace />
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

function LoginGate() {
  const { status } = useAuth();
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
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
