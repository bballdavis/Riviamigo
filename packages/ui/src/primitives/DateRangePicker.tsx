import * as React from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { format, subDays, subMonths, startOfDay, endOfDay } from 'date-fns';
import { cn } from '../lib/utils';

export interface DateRange {
  from: Date;
  to: Date;
}

export type PresetKey = '24h' | '7d' | '30d' | '90d' | '1y';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: '24h', label: 'Last 24h' },
  { key: '7d',  label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '1y',  label: 'Last year' },
];

export function presetToRange(preset: PresetKey): DateRange {
  const now = new Date();
  switch (preset) {
    case '24h': return { from: subDays(now, 1), to: now };
    case '7d':  return { from: startOfDay(subDays(now, 7)), to: endOfDay(now) };
    case '30d': return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
    case '90d': return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) };
    case '1y':  return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) };
  }
}

export interface DateRangePickerProps {
  value: DateRange;
  preset?: PresetKey;
  onChange: (range: DateRange, preset?: PresetKey) => void;
  className?: string;
}

export function DateRangePicker({
  value,
  preset,
  onChange,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayLabel = preset
    ? PRESETS.find((p) => p.key === preset)?.label
    : `${format(value.from, 'MMM d')} – ${format(value.to, 'MMM d, yyyy')}`;

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 h-8 px-3 rounded-lg text-sm',
          'bg-bg-elevated border border-border hover:border-border-strong',
          'text-fg-secondary hover:text-fg transition-colors duration-150'
        )}
      >
        <Calendar className="h-3.5 w-3.5 text-fg-tertiary" />
        {displayLabel}
        <ChevronDown className={cn('h-3.5 w-3.5 text-fg-tertiary transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-bg-elevated border border-border rounded-xl shadow-lg py-1 min-w-[160px]">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                onChange(presetToRange(p.key), p.key);
                setOpen(false);
              }}
              className={cn(
                'w-full text-left px-4 py-2 text-sm transition-colors',
                p.key === preset
                  ? 'text-accent bg-accent-muted'
                  : 'text-fg-secondary hover:text-fg hover:bg-bg-surface'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
