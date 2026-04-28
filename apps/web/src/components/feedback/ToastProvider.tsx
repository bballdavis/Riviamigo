import React, { useEffect, useState } from 'react';

interface ToastPayload {
  title: string;
  message: string;
  code?: string;
  variant?: 'error';
}

interface Toast extends ToastPayload {
  id: number;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      if (!detail?.message) return;

      const id = Date.now();
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
            className="rounded-xl border border-[#F87171]/30 bg-[#7F1D1D]/30 px-4 py-3 text-sm text-fg shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-[#FCA5A5]">{toast.title}</p>
                {toast.code && (
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-[#FCA5A5]/70">
                    {toast.code}
                  </p>
                )}
                <p className="mt-1 break-words text-xs leading-5 text-fg-secondary">{toast.message}</p>
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                className="rounded-md px-2 py-1 text-xs text-fg-tertiary hover:bg-bg-elevated hover:text-fg"
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
