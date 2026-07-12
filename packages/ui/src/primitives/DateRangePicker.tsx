import * as React from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import type { BoundedPresetKey, DashboardTimeframe, DateRange, PresetKey } from '@riviamigo/types';
import {
  addMonths,
  endOfDay,
  endOfMonth,
  format,
  getYear,
  isSameDay,
  isSameMonth,
  isValid,
  parse,
  setHours,
  setMinutes,
  startOfDay,
  startOfMonth,
  subDays,
  subHours,
  subMonths,
} from 'date-fns';
import { cn } from '../lib/utils';

export type { BoundedPresetKey, DashboardTimeframe, DateRange, PresetKey } from '@riviamigo/types';

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: '1h', label: 'Last 1h' },
  { key: '6h', label: 'Last 6h' },
  { key: '12h', label: 'Last 12h' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '1y', label: 'Last year' },
  { key: 'lifetime', label: 'Lifetime' },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: index,
  label: format(new Date(2026, index, 1), 'MMMM'),
}));

const YEAR_OPTIONS = Array.from({ length: 31 }, (_, offset) => {
  const year = getYear(new Date()) - 15 + offset;
  return { value: year, label: String(year) };
});

const TIMEFRAME_PARSE_PATTERNS = [
  'M/d/yy',
  'M/d/yyyy',
  'M/d/yy h:mm a',
  'M/d/yyyy h:mm a',
  'M/d/yy HH:mm',
  'M/d/yyyy HH:mm',
  'MM/dd/yy',
  'MM/dd/yyyy',
  'MM/dd/yy h:mm a',
  'MM/dd/yyyy h:mm a',
  'MM/dd/yy HH:mm',
  'MM/dd/yyyy HH:mm',
];

export interface DateRangePickerProps {
  timeframe: DashboardTimeframe;
  onChange: (timeframe: DashboardTimeframe) => void;
  className?: string;
  triggerClassName?: string;
}

export function presetToRange(preset: BoundedPresetKey): DateRange {
  const now = new Date();
  switch (preset) {
    case '1h':
      return { from: subHours(now, 1), to: now };
    case '6h':
      return { from: subHours(now, 6), to: now };
    case '12h':
      return { from: subHours(now, 12), to: now };
    case '24h':
      return { from: subHours(now, 24), to: now };
    case '7d':
      return { from: startOfDay(subDays(now, 7)), to: endOfDay(now) };
    case '30d':
      return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
    case '90d':
      return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) };
    case '1y':
      return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) };
  }
}

export function DateRangePicker({
  timeframe,
  onChange,
  className,
  triggerClassName,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [customExpanded, setCustomExpanded] = React.useState(timeframe.kind === 'custom');
  const resolvedRange = React.useMemo(() => timeframeToRange(timeframe), [timeframe]);
  const [customFrom, setCustomFrom] = React.useState(resolvedRange?.from ?? new Date());
  const [customTo, setCustomTo] = React.useState(resolvedRange?.to ?? new Date());
  const [customFromInput, setCustomFromInput] = React.useState(formatDateInputValue(resolvedRange?.from ?? new Date()));
  const [customToInput, setCustomToInput] = React.useState(formatDateInputValue(resolvedRange?.to ?? new Date()));
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [monthCursor, setMonthCursor] = React.useState(startOfMonth(resolvedRange?.from ?? new Date()));
  const [target, setTarget] = React.useState<'from' | 'to'>('from');
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  React.useEffect(() => {
    if (timeframe.kind === 'custom') {
      setCustomExpanded(true);
    }

    const nextRange = timeframeToRange(timeframe);
    const fallbackRange = nextRange ?? { from: new Date(), to: new Date() };
    setCustomFrom(fallbackRange.from);
    setCustomTo(fallbackRange.to);
    setCustomFromInput(formatDateInputValue(fallbackRange.from));
    setCustomToInput(formatDateInputValue(fallbackRange.to));
    setMonthCursor(startOfMonth(fallbackRange.from));
    setInputError(null);
  }, [timeframe]);

  const displayLabel = React.useMemo(() => {
    if (timeframe.kind === 'lifetime') return 'Lifetime';
    if (timeframe.kind === 'preset') {
      return PRESETS.find((preset) => preset.key === timeframe.preset)?.label ?? 'Custom range';
    }
    return `${format(timeframe.from, 'MMM d, yyyy h:mm a')} - ${format(timeframe.to, 'MMM d, yyyy h:mm a')}`;
  }, [timeframe]);

  const handleDayPick = (picked: Date) => {
    if (target === 'from') {
      const next = setMinutes(setHours(picked, customFrom.getHours()), customFrom.getMinutes());
      setCustomFrom(next);
      setCustomFromInput(formatDateInputValue(next));
      setMonthCursor(startOfMonth(next));
    } else {
      const next = setMinutes(setHours(picked, customTo.getHours()), customTo.getMinutes());
      setCustomTo(next);
      setCustomToInput(formatDateInputValue(next));
      setMonthCursor(startOfMonth(next));
    }
    setInputError(null);
  };

  const applyCustomRange = () => {
    const parsedFrom = parseUserInput(customFromInput, customFrom);
    const parsedTo = parseUserInput(customToInput, customTo);
    if (!parsedFrom || !parsedTo) {
      setInputError('Enter a valid From and To date, like 1/7/25 6:30 PM.');
      return;
    }
    const normalized = parsedFrom <= parsedTo
      ? { from: parsedFrom, to: parsedTo }
      : { from: parsedTo, to: parsedFrom };
    onChange({ kind: 'custom', ...normalized });
    setOpen(false);
  };

    return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 text-sm',
          'text-fg-secondary transition-colors duration-150 hover:border-border-strong hover:text-fg',
          triggerClassName,
        )}
      >
        <Calendar className="h-3.5 w-3.5 text-fg-tertiary" />
        {displayLabel}
        <ChevronDown className={cn('h-3.5 w-3.5 text-fg-tertiary transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[380px] max-w-[calc(100vw-1rem)] space-y-3 rounded-xl border border-border bg-bg-elevated p-3 shadow-lg sm:left-auto sm:right-0">
          <div className="grid grid-cols-2 gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  if (preset.key === 'lifetime') {
                    setCustomExpanded(false);
                    onChange({ kind: 'lifetime' });
                  } else {
                    setCustomExpanded(false);
                    onChange({ kind: 'preset', preset: preset.key });
                  }
                  setOpen(false);
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                  matchesPreset(timeframe, preset.key)
                    ? 'bg-accent-muted text-accent'
                    : 'text-fg-secondary hover:bg-bg-surface hover:text-fg',
                )}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setCustomExpanded((value) => !value);
                if (!customExpanded) {
                  setTarget('from');
                  setMonthCursor(startOfMonth(customFrom));
                }
              }}
              className={cn(
                'flex items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                customExpanded || timeframe.kind === 'custom'
                  ? 'bg-accent-muted text-accent'
                  : 'text-fg-secondary hover:bg-bg-surface hover:text-fg',
              )}
            >
              <span>Custom Range</span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', customExpanded && 'rotate-180')} />
            </button>
          </div>

          {customExpanded ? (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
                <Calendar className="h-3.5 w-3.5" />
                Custom range
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <DateTimeRow
                  label="From"
                  active={target === 'from'}
                  value={customFrom}
                  inputValue={customFromInput}
                  onInputChange={(value) => {
                    setCustomFromInput(value);
                    const parsed = parseUserInput(value, customFrom);
                    if (parsed) {
                      setCustomFrom(parsed);
                      setMonthCursor(startOfMonth(parsed));
                      setInputError(null);
                    }
                  }}
                  onTarget={() => {
                    setTarget('from');
                    setMonthCursor(startOfMonth(customFrom));
                  }}
                  onHour={(hours) => {
                    const next = setHours(customFrom, hours);
                    setCustomFrom(next);
                    setCustomFromInput(formatDateInputValue(next));
                  }}
                  onMinute={(minutes) => {
                    const next = setMinutes(customFrom, minutes);
                    setCustomFrom(next);
                    setCustomFromInput(formatDateInputValue(next));
                  }}
                />
                <DateTimeRow
                  label="To"
                  active={target === 'to'}
                  value={customTo}
                  inputValue={customToInput}
                  onInputChange={(value) => {
                    setCustomToInput(value);
                    const parsed = parseUserInput(value, customTo);
                    if (parsed) {
                      setCustomTo(parsed);
                      setMonthCursor(startOfMonth(parsed));
                      setInputError(null);
                    }
                  }}
                  onTarget={() => {
                    setTarget('to');
                    setMonthCursor(startOfMonth(customTo));
                  }}
                  onHour={(hours) => {
                    const next = setHours(customTo, hours);
                    setCustomTo(next);
                    setCustomToInput(formatDateInputValue(next));
                  }}
                  onMinute={(minutes) => {
                    const next = setMinutes(customTo, minutes);
                    setCustomTo(next);
                    setCustomToInput(formatDateInputValue(next));
                  }}
                />
              </div>

              <ThemedCalendar
                month={monthCursor}
                selected={target === 'from' ? customFrom : customTo}
                from={customFrom}
                to={customTo}
                onMonth={setMonthCursor}
                onPick={handleDayPick}
              />

              {inputError ? (
                <p className="text-xs text-status-negative">{inputError}</p>
              ) : (
                <p className="text-xs text-fg-tertiary">
                  Applying: {format(customFrom <= customTo ? customFrom : customTo, 'MMM d, yyyy h:mm a')} - {format(customFrom <= customTo ? customTo : customFrom, 'MMM d, yyyy h:mm a')}
                </p>
              )}

              <button
                type="button"
                onClick={applyCustomRange}
                className="h-8 w-full rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90"
              >
                Apply custom range
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DateTimeRow({
  label,
  value,
  inputValue,
  active,
  onInputChange,
  onTarget,
  onHour,
  onMinute,
}: {
  label: string;
  value: Date;
  inputValue: string;
  active: boolean;
  onInputChange: (value: string) => void;
  onTarget: () => void;
  onHour: (hours: number) => void;
  onMinute: (minutes: number) => void;
}) {
  const hours = value.getHours();
  const minutes = snapMinuteToOption(value.getMinutes());

  return (
    <div
      className={cn(
        'w-full min-w-0 rounded-lg border px-2 py-2 text-left',
        active ? 'border-accent bg-accent-muted/40' : 'border-border bg-bg-surface hover:border-border-strong',
      )}
    >
      <button type="button" onClick={onTarget} className="w-full text-left">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-fg-tertiary">mm/dd/yyyy</div>
        </div>
        <div className="mt-1 text-xs text-fg">{format(value, 'EEE, MMM d yyyy')}</div>
      </button>
      <div className="mt-2 grid gap-2">
        <input
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onFocus={onTarget}
          placeholder="6/3/26"
          className="h-8 w-full min-w-0 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg outline-none placeholder:text-fg-tertiary focus:border-accent"
        />
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-fg-tertiary" />
          <select
            value={hours}
            onChange={(event) => onHour(Number(event.target.value))}
            className="h-7 min-w-0 rounded-md border border-border bg-bg-elevated px-1 text-xs text-fg"
          >
            {Array.from({ length: 24 }, (_, index) => (
              <option key={index} value={index}>{index.toString().padStart(2, '0')}</option>
            ))}
          </select>
          <span className="text-fg-tertiary">:</span>
          <select
            value={minutes}
            onChange={(event) => onMinute(Number(event.target.value))}
            className="h-7 min-w-0 rounded-md border border-border bg-bg-elevated px-1 text-xs text-fg"
          >
            {[0, 15, 30, 45].map((minute) => (
              <option key={minute} value={minute}>{minute.toString().padStart(2, '0')}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
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

  for (let index = 0; index < startDayOffset; index += 1) cells.push(null);
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
  }

  return (
    <div className="rounded-lg border border-border bg-bg-surface p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => onMonth(startOfMonth(addMonths(month, -1)))} className="rounded-md p-1 hover:bg-bg-elevated">
          <ChevronLeft className="h-4 w-4 text-fg-secondary" />
        </button>
        <div className="flex items-center gap-2">
          <select
            aria-label="Month"
            value={month.getMonth()}
            onChange={(event) => onMonth(new Date(month.getFullYear(), Number(event.target.value), 1))}
            className="h-8 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg"
          >
            {MONTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            aria-label="Year"
            value={month.getFullYear()}
            onChange={(event) => onMonth(new Date(Number(event.target.value), month.getMonth(), 1))}
            className="h-8 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg"
          >
            {YEAR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => onMonth(startOfMonth(addMonths(month, 1)))} className="rounded-md p-1 hover:bg-bg-elevated">
          <ChevronRight className="h-4 w-4 text-fg-secondary" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-fg-tertiary">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <div key={`${day}-${index}`}>{day}</div>)}
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

function timeframeToRange(timeframe: DashboardTimeframe): DateRange | null {
  switch (timeframe.kind) {
    case 'preset':
      return presetToRange(timeframe.preset);
    case 'custom':
      return normalizeRange({ from: timeframe.from, to: timeframe.to });
    case 'lifetime':
      return null;
  }
}

function normalizeRange(range: DateRange): DateRange {
  return range.from <= range.to ? range : { from: range.to, to: range.from };
}

function parseUserInput(value: string, fallback: Date): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  for (const pattern of TIMEFRAME_PARSE_PATTERNS) {
    const parsed = parse(trimmed, pattern, fallback);
    if (isValid(parsed)) return parsed;
  }

  const nativeDate = new Date(trimmed);
  return isValid(nativeDate) ? nativeDate : null;
}

function formatDateInputValue(value: Date) {
  return format(value, 'M/d/yy');
}

function snapMinuteToOption(value: number) {
  return [0, 15, 30, 45].reduce((closest, option) => (
    Math.abs(option - value) < Math.abs(closest - value) ? option : closest
  ), 0);
}

function matchesPreset(timeframe: DashboardTimeframe, preset: PresetKey) {
  if (preset === 'lifetime') return timeframe.kind === 'lifetime';
  return timeframe.kind === 'preset' && timeframe.preset === preset;
}
