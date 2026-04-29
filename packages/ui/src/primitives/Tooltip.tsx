import * as React from 'react';
import { cn } from '../lib/utils';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
  contentClassName?: string;
}

const sideClasses: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-[calc(100%+0.5rem)]',
  bottom: 'top-[calc(100%+0.5rem)]',
};

const alignClasses: Record<NonNullable<TooltipProps['align']>, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
};

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
  contentClassName,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const tooltipId = React.useId();

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <span aria-describedby={open ? tooltipId : undefined} className="inline-flex">
        {children}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        aria-hidden={!open}
        className={cn(
          'pointer-events-none absolute z-20 w-56 rounded-lg border border-border bg-bg-surface px-3 py-2 text-[11px] normal-case tracking-normal text-fg shadow-lg transition-opacity duration-150',
          sideClasses[side],
          alignClasses[align],
          open ? 'opacity-100' : 'opacity-0',
          contentClassName
        )}
      >
        {content}
      </span>
    </span>
  );
}
