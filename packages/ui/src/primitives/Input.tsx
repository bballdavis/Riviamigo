import * as React from 'react';
import { cn } from '../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, iconLeft, iconRight, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-fg-secondary">
            {label}
          </label>
        )}
        <div className="relative">
          {iconLeft && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary">
              {iconLeft}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full h-9 rounded-lg border bg-bg-elevated text-fg text-base sm:text-sm',
              'placeholder:text-fg-tertiary',
              'transition-colors duration-150',
              'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
              error
                ? 'border-[#F87171]/50 focus:ring-[#F87171] focus:border-[#F87171]'
                : 'border-border hover:border-border-strong',
              iconLeft ? 'pl-9' : 'pl-3',
              iconRight ? 'pr-9' : 'pr-3',
              className
            )}
            {...props}
          />
          {iconRight && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-tertiary">
              {iconRight}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
        {hint && !error && <p className="text-xs text-fg-tertiary">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
