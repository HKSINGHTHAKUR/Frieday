import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { ChartNoAxesColumn, FolderGit2, LayoutDashboard, Settings, Sparkles, X } from 'lucide-react';

/**
 * Mobile slide-over navigation (design_system.md §15: "hidden behind
 * hamburger <640px (slide-over with scrim)"; §27: "topbar condenses").
 *
 * Reuses the same link set and active-state treatment as the desktop
 * Sidebar so the two never drift. Focus is trapped inside the panel while
 * open, Escape closes it, and the scrim click closes it.
 */
const LINKS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/timeline', label: 'Timeline', icon: ChartNoAxesColumn, end: false },
  { to: '/repositories', label: 'Repositories', icon: FolderGit2, end: false },
  { to: '/insights', label: 'Insights', icon: Sparkles, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

export default function MobileNav({ open, onClose }) {
  const panelRef = useRef(null);
  const previousFocus = useRef(null);

  /** design_system.md §22/§28: focus trap — Tab/Shift+Tab cycle inside the panel. */
  function trapTabFocus(event) {
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !panel.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        trapTabFocus(event);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    // Move focus into the panel so keyboard users are not stranded behind it.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Return focus to the trigger that opened the panel.
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 sm:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-text/40"
      />
      <nav
        ref={panelRef}
        tabIndex={-1}
        aria-label="Primary"
        className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col gap-8 border-r border-border bg-surface p-16 shadow-lg outline-none"
      >
        <div className="flex items-center justify-between">
          <span className="text-base font-bold tracking-tight text-text">Frieday</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex h-32 w-32 items-center justify-center rounded-sm text-text2 hover:bg-surface2"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-8">
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
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
      </nav>
    </div>
  );
}
