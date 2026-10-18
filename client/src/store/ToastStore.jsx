/**
 * Toast host + store (T5.3, design_system.md §23). The existing Toast
 * primitive renders one notification; this store owns queueing so any view
 * can push transient feedback without a second implementation.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Toast from '../components/ui/Toast.jsx';

export const ToastContext = createContext(null);

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone, title) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((list) => [...list, { id, tone, title }]);
      if (tone !== 'danger') {
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="fixed bottom-16 right-16 z-50 flex w-80 flex-col gap-8"
      >
        {toasts.map((t) => (
          <Toast key={t.id} tone={t.tone} title={t.title} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
