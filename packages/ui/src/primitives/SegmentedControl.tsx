import * as React from 'react';
import { cn } from '../lib/utils';

export interface SegmentedControlOption<TValue extends string> {
  value: TValue;
  label: React.ReactNode;
}

export interface SegmentedControlProps<TValue extends string> {
  /** Accessible name for the group. */
  label: string;
  value: TValue;
  options: Array<SegmentedControlOption<TValue>>;
  onChange: (value: TValue) => void;
  /** Stretch to the container with equal-width options instead of fitting the labels. */
  fullWidth?: boolean;
  /** Extra classes for the group, such as a fixed control height. */
  className?: string;
  /** Extra classes for each option, such as padding or text size. */
  optionClassName?: string;
}

/**
 * A one-of-several toggle. The selected option carries an accent border and a
 * light accent tint, not only a background change, so the choice reads at a
 * glance in both themes. Options stay at least 44px tall on phones.
 */
export function SegmentedControl<TValue extends string>({
  label,
  value,
  options,
  onChange,
  fullWidth = false,
  className,
  optionClassName,
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'gap-1 rounded-xl border border-border-strong bg-bg-elevated/50 p-1',
        fullWidth ? 'grid w-full' : 'inline-flex shrink-0',
        className,
      )}
      style={fullWidth ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-11 rounded-lg border px-3 text-xs font-medium transition-colors sm:min-h-0',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              selected
                ? 'border-accent bg-accent/10 font-semibold text-fg shadow-sm'
                : 'border-transparent text-fg-secondary hover:bg-bg-elevated hover:text-fg',
              optionClassName,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
