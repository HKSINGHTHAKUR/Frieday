import { NavLink } from 'react-router-dom';
import { ChartNoAxesColumn, FolderGit2, LayoutDashboard, Settings, Sparkles } from 'lucide-react';
import { formatAgo } from '../../lib/format.js';
import { useAuth } from '../../hooks/useAuth.js';

const LINKS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/timeline', label: 'Timeline', icon: ChartNoAxesColumn, end: false },
  { to: '/repositories', label: 'Repositories', icon: FolderGit2, end: false },
  { to: '/insights', label: 'Insights', icon: Sparkles, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

/**
 * App sidebar (design_system.md §14–15). Bottom block: connection card
 * (avatar + login + status dot: green connected, red disconnected).
 */
export default function Sidebar() {
  const { user, connected, lastSyncedAt } = useAuth();
  return (
    <nav
      aria-label="Primary"
      className="flex w-sidebar shrink-0 flex-col gap-8 border-r border-border bg-surface p-16"
    >
      <div className="flex flex-col gap-16">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-8 rounded-sm px-12 py-8 text-sm font-medium ${
                isActive ? 'bg-accent-soft text-accent-hover' : 'text-text2 hover:bg-surface2'
              }`
            }
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-8 rounded-md border border-border bg-bg p-12">
        <span className="relative flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface2">
          {user && user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-text2">
              {user ? user.login.slice(0, 1).toUpperCase() : '?'}
            </span>
          )}
          <span
            aria-hidden="true"
            className={`absolute bottom-0 right-0 h-8 w-8 rounded-full border-2 border-bg ${
              connected ? 'bg-success' : 'bg-danger'
            }`}
          />
        </span>
        <div role="status" className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{user ? user.login : '—'}</p>
          <p className="text-xs text-text3">
            {connected
              ? lastSyncedAt
                ? `Last synced ${formatAgo(lastSyncedAt)}`
                : 'Not synced yet'
              : 'Disconnected'}
          </p>
        </div>
      </div>
    </nav>
  );
}
