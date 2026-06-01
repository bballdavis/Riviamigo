import * as React from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import {
  addMonths,
  endOfDay,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  setHours,
  setMinutes,
  startOfDay,
  startOfMonth,
  subDays,
  subHours,
  subMonths,
} from 'date-fns';
import { cn } from '../lib/utils';

export interface DateRange {
  from: Date;
  to: Date;
}

export type PresetKey = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d' | '1y';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: '1h', label: 'Last 1h' },
  { key: '6h', label: 'Last 6h' },
  { key: '12h', label: 'Last 12h' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '1y', label: 'Last year' },
];

export function presetToRange(preset: PresetKey): DateRange {
  const now = new Date();
  switch (preset) {
    case '1h': return { from: subHours(now, 1), to: now };
    case '6h': return { from: subHours(now, 6), to: now };
    case '12h': return { from: subHours(now, 12), to: now };
    case '24h': return { from: subHours(now, 24), to: now };
    case '7d': return { from: startOfDay(subDays(now, 7)), to: endOfDay(now) };
    case '30d': return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
    case '90d': return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) };
    case '1y': return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) };
  }
}

export interface DateRangePickerProps {
  value: DateRange;
  preset?: PresetKey | undefined;
  onChange: (range: DateRange, preset?: PresetKey) => void;
  className?: string;
  triggerClassName?: string;
}

export function DateRangePicker({
  value,
  preset,
  onChange,
  className,
  triggerClassName,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState(value.from);
  const [customTo, setCustomTo] = React.useState(value.to);
  const [monthCursor, setMonthCursor] = React.useState(startOfMonth(value.from));
  const [target, setTarget] = React.useState<'from' | 'to'>('from');
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  React.useEffect(() => {
    setCustomFrom(value.from);
    setCustomTo(value.to);
  }, [value.from, value.to]);

  const displayLabel = preset
    ? PRESETS.find((p) => p.key === preset)?.label
    : `${format(value.from, 'MMM d, yyyy h:mm a')} - ${format(value.to, 'MMM d, yyyy h:mm a')}`;

  const handleDayPick = (picked: Date) => {
    if (target === 'from') {
      setCustomFrom(setMinutes(setHours(picked, customFrom.getHours()), customFrom.getMinutes()));
    } else {
      setCustomTo(setMinutes(setHours(picked, customTo.getHours()), customTo.getMinutes()));
    }
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 h-9 px-3 rounded-lg text-sm',
          'bg-bg-elevated border border-border hover:border-border-strong',
          'text-fg-secondary hover:text-fg transition-colors duration-150',
          triggerClassName,
        )}
      >
        <Calendar className="h-3.5 w-3.5 text-fg-tertiary" />
        {displayLabel}
        <ChevronDown className={cn('h-3.5 w-3.5 text-fg-tertiary transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-50 bg-bg-elevated border border-border rounded-xl shadow-lg p-3 min-w-[320px] max-w-[calc(100vw-1rem)] space-y-3">
          <div className="grid grid-cols-2 gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  onChange(presetToRange(p.key), p.key);
                  setOpen(false);
                }}
                className={cn(
                  'text-left px-3 py-1.5 text-sm rounded-md transition-colors',
                  p.key === preset
                    ? 'text-accent bg-accent-muted'
                    : 'text-fg-secondary hover:text-fg hover:bg-bg-surface'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
              <Calendar className="h-3.5 w-3.5" />
              Custom range
            </div>

            <DateTimeRow
              label="From"
              active={target === 'from'}
              value={customFrom}
              onTarget={() => {
                setTarget('from');
                setMonthCursor(startOfMonth(customFrom));
              }}
              onTime={(hours, minutes) => setCustomFrom(setMinutes(setHours(customFrom, hours), minutes))}
            />
            <DateTimeRow
              label="To"
              active={target === 'to'}
              value={customTo}
              onTarget={() => {
                setTarget('to');
                setMonthCursor(startOfMonth(customTo));
              }}
              onTime={(hours, minutes) => setCustomTo(setMinutes(setHours(customTo, hours), minutes))}
            />

            <ThemedCalendar
              month={monthCursor}
              selected={target === 'from' ? customFrom : customTo}
              from={customFrom}
              to={customTo}
              onMonth={setMonthCursor}
              onPick={handleDayPick}
            />

            <button
              type="button"
              onClick={() => {
                const nextFrom = customFrom;
                const nextTo = customTo;
                if (Number.isNaN(nextFrom.getTime()) || Number.isNaN(nextTo.getTime())) return;
                onChange(nextFrom <= nextTo ? { from: nextFrom, to: nextTo } : { from: nextTo, to: nextFrom });
                setOpen(false);
              }}
              className="h-8 w-full rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90"
            >
              Apply custom range
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DateTimeRow({
  label,
  value,
  active,
  onTarget,
  onTime,
}: {
  label: string;
  value: Date;
  active: boolean;
  onTarget: () => void;
  onTime: (hours: number, minutes: number) => void;
}) {
  const hours = value.getHours();
  const minutes = value.getMinutes();
  return (
    <button
      type="button"
      onClick={onTarget}
      className={cn(
        'w-full rounded-lg border px-2 py-2 text-left',
        active ? 'border-accent bg-accent-muted/40' : 'border-border bg-bg-surface hover:border-border-strong',
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xs text-fg">{format(value, 'EEE, MMM d yyyy')}</span>
        <Clock className="h-3.5 w-3.5 text-fg-tertiary" />
        <select
          value={hours}
          onChange={(event) => onTime(Number(event.target.value), minutes)}
          className="h-7 rounded-md border border-border bg-bg-elevated px-1 text-xs text-fg"
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
          ))}
        </select>
        <span className="text-fg-tertiary">:</span>
        <select
          value={minutes}
          onChange={(event) => onTime(hours, Number(event.target.value))}
          className="h-7 rounded-md border border-border bg-bg-elevated px-1 text-xs text-fg"
        >
          {Array.from({ length: 60 }, (_, i) => (
            <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
          ))}
        </select>
      </div>
    </button>
  );
}

function ThemedCalendar({
  month,
  selected,
  from,
  to,
  onMonth,
  onPick,
}: {
  month: Date;
  selected: Date;
  from: Date;
  to: Date;
  onMonth: (next: Date) => void;
  onPick: (date: Date) => void;
}) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const startDayOffset = monthStart.getDay();
  const totalDays = monthEnd.getDate();
  const cells: Array<Date | null> = [];
  for (let i = 0; i < startDayOffset; i += 1) cells.push(null);
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
  }

  return (
    <div className="rounded-lg border border-border bg-bg-surface p-2">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => onMonth(startOfMonth(addMonths(month, -1)))} className="rounded-md p-1 hover:bg-bg-elevated">
          <ChevronLeft className="h-4 w-4 text-fg-secondary" />
        </button>
        <div className="text-sm font-medium text-fg">{format(month, 'MMMM yyyy')}</div>
        <button type="button" onClick={() => onMonth(startOfMonth(addMonths(month, 1)))} className="rounded-md p-1 hover:bg-bg-elevated">
          <ChevronRight className="h-4 w-4 text-fg-secondary" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-fg-tertiary">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => <div key={day}>{day}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date, index) => {
          if (!date) return <div key={`blank-${index}`} className="h-8" />;
          const inRange = date >= startOfDay(from) && date <= startOfDay(to);
          const selectedDay = isSameDay(date, selected);
          return (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => onPick(date)}
              className={cn(
                'h-8 rounded-md text-xs',
                !isSameMonth(date, month) && 'text-fg-tertiary/40',
                inRange ? 'bg-accent-muted text-fg' : 'text-fg-secondary hover:bg-bg-elevated hover:text-fg',
                selectedDay && 'ring-1 ring-accent text-accent',
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

