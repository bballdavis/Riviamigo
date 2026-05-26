import * as React from 'react';
import { cn } from '../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  dot?: boolean;
}

const variants: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-bg-elevated text-fg-secondary border border-border',
  accent:  'bg-accent-muted text-accent border border-accent/20',
  success: 'bg-status-positive/10 text-status-positive border border-status-positive/20',
  warning: 'bg-status-warning/10 text-status-warning border border-status-warning/20',
  danger:  'bg-status-danger/10 text-status-danger border border-status-danger/20',
  info:    'bg-status-info/10 text-status-info border border-status-info/20',
};

const sizes: Record<NonNullable<BadgeProps['size']>, string> = {
  sm: 'h-5 px-1.5 text-[10px] gap-1',
  md: 'h-6 px-2 text-xs gap-1.5',
};

export function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-md',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      )}
      {children}
    </span>
  );
}
