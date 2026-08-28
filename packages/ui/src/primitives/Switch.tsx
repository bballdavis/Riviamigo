import * as React from 'react';
import { cn } from '../lib/utils';

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  size?: 'sm' | 'md';
}

/** Compact, keyboard-accessible boolean control shared by settings and editors. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onChange, size = 'sm', className, disabled, onClick, ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) onChange?.(!checked);
      }}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-[22px] w-10' : 'h-6 w-11',
        checked ? 'border-accent/60 bg-accent' : 'border-border bg-bg-elevated',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute rounded-full shadow-sm transition-transform duration-150',
          size === 'sm' ? 'top-[2px] h-4 w-4' : 'top-1 h-4 w-4',
          checked
            ? size === 'sm' ? 'translate-x-[22px] bg-fg' : 'translate-x-6 bg-fg'
            : size === 'sm' ? 'translate-x-[2px] bg-fg-tertiary' : 'translate-x-1 bg-fg-tertiary',
        )}
      />
    </button>
  ),
);

Switch.displayName = 'Switch';
