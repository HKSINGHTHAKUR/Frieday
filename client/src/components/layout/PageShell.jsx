import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import SyncProgress from '../domain/SyncProgress.jsx';

/**
 * Page shell: skip link + sidebar + topbar + content column (design_system.md §8, §16).
 * The global SyncProgress card renders inside the content column, above the
 * active page (prd.md §20: progress instead of empty for a mid-sync new user).
 * @param {{ children: import('react').ReactNode }} props
 */
export default function PageShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-16 focus:top-16 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-16 focus:py-8"
      >
        Skip to content
      </a>
      <Topbar />
      <div className="flex flex-1">
        <Sidebar />
        <main id="main-content" className="mx-auto w-full max-w-content flex-1 p-24">
          <SyncProgress />
          {children}
        </main>
      </div>
    </div>
  );
}
