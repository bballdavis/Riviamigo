import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

export interface ResponsiveDialogProps {
  titleId: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/** Opaque, focus-managed dialog that becomes a safe-area fullscreen surface on mobile. */
export function ResponsiveDialog({ titleId, onClose, children, className }: ResponsiveDialogProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  // Capture the trigger during render, before a descendant `autoFocus` runs
  // during the portal commit.
  const previousFocusRef = React.useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-bg-page/85 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn('flex min-h-[100dvh] w-full flex-col overflow-hidden bg-bg-surface shadow-lg sm:min-h-0 sm:max-h-[min(42rem,calc(100dvh-2rem))] sm:max-w-lg sm:rounded-xl sm:border sm:border-border', className)}>{children}</div>
    </div>,
    document.body,
  );
}
