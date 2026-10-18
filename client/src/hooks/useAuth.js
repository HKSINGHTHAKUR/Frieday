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

export function useAuth() {
  return useContext(AuthContext);
}
