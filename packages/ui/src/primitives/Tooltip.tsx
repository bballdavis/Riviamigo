import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
  contentClassName?: string;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
  contentClassName,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<{ top: number; left: number; visibility: 'hidden' | 'visible' }>({
    top: 0,
    left: 0,
    visibility: 'hidden',
  });
  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  const triggerRef = React.useRef<HTMLSpanElement | null>(null);
  const contentRef = React.useRef<HTMLSpanElement | null>(null);
  const tooltipId = React.useId();

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const content = contentRef.current;

      if (!trigger || !content) {
        return;
      }

      const gap = 8;
      const viewportPadding = 8;
      const triggerRect = trigger.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const preferredTop = side === 'top'
        ? triggerRect.top - contentRect.height - gap
        : triggerRect.bottom + gap;
      const flippedTop = side === 'top'
        ? triggerRect.bottom + gap
        : triggerRect.top - contentRect.height - gap;

      let top = preferredTop;
      if (top < viewportPadding || top + contentRect.height > viewportHeight - viewportPadding) {
        top = flippedTop;
      }
      top = Math.min(
        Math.max(top, viewportPadding),
        Math.max(viewportPadding, viewportHeight - viewportPadding - contentRect.height),
      );

      let left = triggerRect.left;
      if (align === 'center') {
        left = triggerRect.left + (triggerRect.width / 2) - (contentRect.width / 2);
      } else if (align === 'end') {
        left = triggerRect.right - contentRect.width;
      }

      left = Math.min(
        Math.max(left, viewportPadding),
        Math.max(viewportPadding, viewportWidth - viewportPadding - contentRect.width),
      );

      setPosition({ top, left, visibility: 'visible' });
    };

    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, open, side, content]);

  React.useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node | null)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const tooltip = open ? (
    <span
      id={tooltipId}
      ref={contentRef}
      role="tooltip"
      aria-hidden={!open}
      className={cn(
        'pointer-events-none fixed z-50 max-h-[calc(100vh-1rem)] w-56 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border bg-bg-surface px-3 py-2 text-[11px] normal-case tracking-normal text-fg shadow-lg transition-opacity duration-150',
        open ? 'opacity-100' : 'opacity-0',
        contentClassName
      )}
      style={{ top: position.top, left: position.left, visibility: position.visibility }}
    >
      {content}
    </span>
  ) : null;

  const describedChild = React.isValidElement(children)
    ? React.cloneElement(
      children as React.ReactElement<{ 'aria-describedby'?: string }>,
      {
        'aria-describedby': [
          (children as React.ReactElement<{ 'aria-describedby'?: string }>).props['aria-describedby'],
          open ? tooltipId : null,
        ].filter(Boolean).join(' ') || undefined,
      },
    )
    : children;

  return (
    <span
      ref={rootRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch') setOpen(true);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <span ref={triggerRef} className="inline-flex">
        {describedChild}
      </span>
      {typeof document !== 'undefined' ? createPortal(tooltip, document.body) : tooltip}
    </span>
  );
}
