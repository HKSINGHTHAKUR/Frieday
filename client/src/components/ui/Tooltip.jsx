import { useState } from 'react';

/**
 * Accessible tooltip: hover + focus trigger, dark surface (design_system.md §21).
 * @param {{ label: string, children: import('react').ReactNode }} props
 */
export default function Tooltip({ label, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-8 max-w-narrow -translate-x-1/2 rounded-sm bg-text px-8 py-4 text-xs text-white"
        >
          {label}
        </span>
      )}
    </span>
  );
}
