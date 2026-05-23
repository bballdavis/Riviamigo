import React, { useEffect, useState } from 'react';

// Module-level counter — `Date.now()` only has ms precision, so two toasts
// fired in the same millisecond would share the same key and trigger a React
// duplicate-key warning.
let _nextToastId = 0;

interface ToastPayload {
  title: string;
  message: string;
  code?: string;
  variant?: 'error' | 'warning' | 'success' | 'info';
}

interface Toast extends ToastPayload {
  id: number;
}

const TOAST_VARIANT_CLASSNAMES: Record<NonNullable<ToastPayload['variant']> | 'default', {
  container: string;
  title: string;
}> = {
  default: {
    container: 'border-border-strong',
    title: 'text-fg',
  },
  error: {
    container: 'border-status-danger/70 bg-status-danger/10',
    title: 'text-status-danger',
  },
  warning: {
    container: 'border-status-warning/70 bg-status-warning/10',
    title: 'text-status-warning',
  },
  success: {
    container: 'border-status-positive/70 bg-status-positive/10',
    title: 'text-status-positive',
  },
  info: {
    container: 'border-status-info/70 bg-status-info/10',
    title: 'text-status-info',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      if (!detail?.message) return;

      const id = ++_nextToastId;
      setToasts((current) => [...current.slice(-2), { ...detail, id }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 7000);
    }

    window.addEventListener('riviamigo:toast', handleToast);
    return () => window.removeEventListener('riviamigo:toast', handleToast);
  }, []);

  return (
    <>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-xl border bg-bg-surface/95 px-4 py-3 text-base text-fg shadow-[0_12px_40px_rgba(0,0,0,0.2)] backdrop-blur-md ${TOAST_VARIANT_CLASSNAMES[toast.variant ?? 'default'].container}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-sm font-semibold leading-6 ${TOAST_VARIANT_CLASSNAMES[toast.variant ?? 'default'].title}`}>{toast.title}</p>
                {toast.code && (
                  <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-secondary">
                    {toast.code}
                  </p>
                )}
                <p className="mt-1 break-words text-sm leading-6 text-fg">{toast.message}</p>
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                className="rounded-md px-2 py-1 text-sm font-medium text-fg-secondary hover:bg-bg-elevated hover:text-fg"
                onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
