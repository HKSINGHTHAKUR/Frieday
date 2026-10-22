/**
 * useAuth (tasks.md T1.3): read the app-wide session state + actions.
 * @returns {{
 *   status: 'loading'|'authenticated'|'unauthenticated'|'error',
 *   user: { githubId: number, login: string, avatarUrl: string, profileUrl: string, scopes: string[] } | null,
 *   connected: boolean | null,
 *   lastSyncedAt: string | null,
 *   error: string | null,
 *   logout: () => Promise<void>,
 *   disconnect: () => Promise<void>,
 *   deleteData: () => Promise<void>,
 *   loadMe: () => Promise<void>,
 *   refreshSession: () => Promise<boolean>,
 * }}
 */
import { useContext } from 'react';
import { AuthContext } from '../store/AuthStore.jsx';

/**
 * The session facts to read when no auth provider is above the component
 * (e.g. a page rendered standalone). "unauthenticated" is the only safe
 * reading — it never invents a session.
 */
const ANONYMOUS = Object.freeze({
  status: 'unauthenticated',
  user: null,
  connected: null,
  lastSyncedAt: null,
  error: null,
});

export function useAuth() {
  return useContext(AuthContext) ?? ANONYMOUS;
}
