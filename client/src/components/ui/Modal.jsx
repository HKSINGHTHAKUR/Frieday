import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Button from './Button.jsx';

/**
 * Centered modal with focus trap + return focus (design_system.md §22, §28).
 * @param {{
 *   title: string,
 *   onClose: () => void,
 *   children: import('react').ReactNode,
 *   footer?: import('react').ReactNode,
 * }} props
 */
export default function Modal({ title, onClose, children, footer }) {
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);

  /** design_system.md §22: focus trap — Tab/Shift+Tab cycle inside the dialog. */
  function trapTabFocus(event) {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = dialog.querySelectorAll(
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
      (document.activeElement === last || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    previousFocus.current = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        trapTabFocus(event);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocus.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-narrow rounded-md bg-surface p-24 shadow-lg"
      >
        <div className="mb-16 flex items-center justify-between">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
        {children}
        {footer && <div className="mt-24 flex justify-end gap-8">{footer}</div>}
      </div>
    </div>
  );
}
