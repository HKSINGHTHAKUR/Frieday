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
 *
 * Responsive (design_system.md §15, §27):
 *   - >= 900px: full 248px sidebar.
 *   - < 900px:  64px icon rail (labels visually hidden, tooltips on hover).
 *   - < 640px:  hidden entirely — the Topbar hamburger opens a slide-over
 *               with a scrim (see Topbar.jsx), so the rail never squeezes
 *               the content column below 320px.
 */
export default function Sidebar() {
  const { user, connected, lastSyncedAt } = useAuth();
  return (
    <nav
      aria-label="Primary"
      // design_system.md §15/§27: 64px icon rail from 640px, full 248px rail
      // from 900px, hidden below 640px (the topbar hamburger opens the
      // MobileNav slide-over there). The rail is never absent, so there is
      // no navigation dead zone between 640px and 900px.
      className="hidden w-rail shrink-0 flex-col gap-8 border-r border-border bg-surface p-8 md:w-sidebar md:p-16 sm:flex"
    >
      <div className="flex flex-col gap-16">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={label}
            className={({ isActive }) =>
              `flex items-center gap-8 rounded-sm px-12 py-8 text-sm font-medium md:justify-start ${
                isActive ? 'bg-accent-soft text-accent-hover' : 'text-text2 hover:bg-surface2'
              }`
            }
          >
            <Icon size={16} aria-hidden="true" className="shrink-0" />
            {/* Label collapses with the rail below 900px; the icon keeps an
                accessible name via the link's `title` + hidden text. */}
            <span className="hidden md:inline">{label}</span>
            <span className="sr-only md:hidden">{label}</span>
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
          {/* In the 64px rail only the avatar fits; the text is visually
              hidden but stays in the accessibility tree. */}
          <p className="hidden truncate text-sm font-medium text-text md:block">{user ? user.login : '—'}</p>
          <p className="hidden text-xs text-text3 md:block">
            {connected
              ? lastSyncedAt
                ? `Last synced ${formatAgo(lastSyncedAt)}`
                : 'Not synced yet'
              : 'Disconnected'}
          </p>
          <span className="sr-only md:hidden">
            {user ? user.login : '—'} —{' '}
            {connected
              ? lastSyncedAt
                ? `Last synced ${formatAgo(lastSyncedAt)}`
                : 'Not synced yet'
              : 'Disconnected'}
          </span>
        </div>
      </div>
    </nav>
  );
}
