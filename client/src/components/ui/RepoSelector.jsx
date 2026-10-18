import { memo, useState } from 'react';
import Button from '../ui/Button.jsx';

/**
 * RepoSelector — searchable select for repository filtering.
 * Controlled via `selectedRepoId` + `onChange` (parent syncs to URL).
 */
export const RepoSelector = memo(function RepoSelector({
  repositories = [],
  selectedRepoId = null,
  onChange,
  className = '',
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = search
    ? repositories.filter((r) => r.fullName?.toLowerCase().includes(search.toLowerCase()))
    : repositories;

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-between text-left"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label="Filter repositories"
        >
          <span className="truncate flex-1">
            {selectedRepoId
              ? repositories.find((r) => r._id?.toString() === selectedRepoId)?.fullName
              : 'All repositories'}
          </span>
          <span className="ml-4">▼</span>
        </Button>
        {isOpen && (
          <div
            className="absolute z-10 mt-4 w-full max-h-96 overflow-auto rounded-md bg-surface border border-border shadow-lg"
            role="listbox"
          >
            <div className="p-4 border-b border-border">
              <input
                type="search"
                placeholder="Search repositories…"
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-8 py-4 text-sm rounded-md border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label="Search repositories"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-auto" role="listbox">
              <button
                role="option"
                aria-selected={!selectedRepoId}
                onClick={() => {
                  setIsOpen(false);
                  onChange?.(null);
                }}
                className="w-full px-12 py-8 text-left text-sm hover:bg-surface2"
              >
                All repositories
              </button>
              {filtered.map((repo) => (
                <button
                  key={repo._id}
                  role="option"
                  aria-selected={repo._id?.toString() === selectedRepoId}
                  onClick={() => {
                    setIsOpen(false);
                    onChange?.(repo._id.toString());
                  }}
                  className="w-full px-12 py-8 text-left text-sm hover:bg-surface2"
                >
                  <div className="flex items-center gap-8">
                    <span className="truncate flex-1">{repo.fullName}</span>
                    <span className="text-xs text-text3">{repo.visibility}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default RepoSelector;
