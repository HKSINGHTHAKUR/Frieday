import LoginPage from '../components/auth/LoginPage.jsx';

/**
 * Login route (tasks.md T1.1).
 *
 * The cinematic GitHub authentication composition lives in
 * `components/auth/LoginPage.jsx`; this route is a thin mount so the app's
 * routing and the auth gate stay unchanged.
 *
 * The GitHub OAuth flow itself is unchanged: `Continue with GitHub` navigates
 * to the backend's existing `/api/auth/github` start route, and the backend
 * owns the state cookie, the callback, the session and the post-login
 * redirect.
 */
export default function Login() {
  return <LoginPage />;
}
