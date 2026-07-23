import { formatISO, isValid, parse, subHours } from 'date-fns';
import type { BoundedPresetKey, DashboardTimeframe, DateRange, PresetKey } from '@riviamigo/types';
import {
  appDatePartsToDate,
  endOfAppDay,
  formatAppDateTime,
  shiftAppCalendarDays,
  startOfAppDay,
} from '@riviamigo/ui/lib/dateTime';

export type { BoundedPresetKey, DashboardTimeframe, DateRange, PresetKey } from '@riviamigo/types';

export const BOUNDED_PRESET_KEYS: readonly BoundedPresetKey[] = ['1h', '6h', '12h', '24h', '7d', '30d', '90d', '1y'];
export const PRESET_KEYS: readonly PresetKey[] = [...BOUNDED_PRESET_KEYS, 'lifetime'];
export const DEFAULT_PRESET: BoundedPresetKey = '30d';
export const DEFAULT_TIMEFRAME: DashboardTimeframe = { kind: 'preset', preset: DEFAULT_PRESET };

const DASHBOARD_TIMEFRAME_STORAGE_KEY = 'rm-dashboard-timeframe';

type StoredDashboardTimeframe =
  | { kind: 'preset'; preset: string }
  | { kind: 'custom'; from: string; to: string }
  | { kind: 'lifetime' }
  | { preset?: string; from?: string; to?: string };

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
      return { from: startOfAppDay(shiftAppCalendarDays(now, -7)), to: endOfAppDay(now) };
    case '30d':
      return { from: startOfAppDay(shiftAppCalendarDays(now, -30)), to: endOfAppDay(now) };
    case '90d':
      return { from: startOfAppDay(shiftAppCalendarDays(now, -90)), to: endOfAppDay(now) };
    case '1y':
      return { from: startOfAppDay(shiftAppCalendarDays(now, -365)), to: endOfAppDay(now) };
  }
}

export function getTimeframeRange(timeframe: DashboardTimeframe): DateRange | null {
  switch (timeframe.kind) {
    case 'preset':
      return presetToRange(timeframe.preset);
    case 'custom':
      return normalizeDateRange({ from: timeframe.from, to: timeframe.to });
    case 'lifetime':
      return null;
  }
}

export function rangeToIso(range: DateRange): { from: string; to: string } {
  return {
    from: formatISO(range.from),
    to: formatISO(range.to),
  };
}

export function timeframeToQuery(timeframe: DashboardTimeframe): {
  from: string | null;
  to: string | null;
  lifetime: boolean;
  cacheKey: string;
} {
  if (timeframe.kind === 'lifetime') {
    return { from: null, to: null, lifetime: true, cacheKey: 'lifetime' };
  }

  const range = getTimeframeRange(timeframe);
  if (!range) {
    return { from: null, to: null, lifetime: true, cacheKey: 'lifetime' };
  }

  const { from, to } = rangeToIso(range);
  const cacheKey = timeframe.kind === 'preset'
    ? `preset:${timeframe.preset}`
    : `custom:${from}:${to}`;
  return { from, to, lifetime: false, cacheKey };
}

export function getTimeframeLabel(timeframe: DashboardTimeframe): string {
  switch (timeframe.kind) {
    case 'preset':
      return PRESET_LABELS[timeframe.preset];
    case 'lifetime':
      return 'Lifetime';
    case 'custom':
      return `${formatRangeDisplay(timeframe.from)} - ${formatRangeDisplay(timeframe.to)}`;
  }
}

export function normalizeDateRange(range: DateRange): DateRange {
  return range.from <= range.to ? range : { from: range.to, to: range.from };
}

export function loadDashboardTimeframe(): DashboardTimeframe | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_TIMEFRAME_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredDashboardTimeframe;

    if (parsed && typeof parsed === 'object' && 'kind' in parsed && parsed.kind === 'lifetime') {
      return { kind: 'lifetime' };
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      'kind' in parsed &&
      parsed.kind === 'preset' &&
      'preset' in parsed &&
      typeof parsed.preset === 'string' &&
      BOUNDED_PRESET_KEYS.includes(parsed.preset as BoundedPresetKey)
    ) {
      return { kind: 'preset', preset: parsed.preset as BoundedPresetKey };
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      'kind' in parsed &&
      parsed.kind === 'custom' &&
      'from' in parsed &&
      'to' in parsed &&
      typeof parsed.from === 'string' &&
      typeof parsed.to === 'string'
    ) {
      const custom = parseStoredCustomRange(parsed.from, parsed.to);
      return custom ? { kind: 'custom', ...custom } : null;
    }

    if (parsed && typeof parsed === 'object' && 'preset' in parsed && typeof parsed.preset === 'string') {
      if (parsed.preset === 'lifetime') return { kind: 'lifetime' };
      if (BOUNDED_PRESET_KEYS.includes(parsed.preset as BoundedPresetKey)) {
        return { kind: 'preset', preset: parsed.preset as BoundedPresetKey };
      }
    }

    if (parsed && typeof parsed === 'object' && 'from' in parsed && 'to' in parsed && typeof parsed.from === 'string' && typeof parsed.to === 'string') {
      const custom = parseStoredCustomRange(parsed.from, parsed.to);
      return custom ? { kind: 'custom', ...custom } : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function saveDashboardTimeframe(timeframe: DashboardTimeframe) {
  if (typeof window === 'undefined') return;

  try {
    const payload = serializeDashboardTimeframe(timeframe);
    window.sessionStorage.setItem(DASHBOARD_TIMEFRAME_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable or full; the picker still works in-memory.
  }
}

export function serializeDashboardTimeframe(timeframe: DashboardTimeframe): StoredDashboardTimeframe {
  switch (timeframe.kind) {
    case 'preset':
      return { kind: 'preset', preset: timeframe.preset };
    case 'lifetime':
      return { kind: 'lifetime' };
    case 'custom': {
      const normalized = normalizeDateRange(timeframe);
      return {
        kind: 'custom',
        from: formatISO(normalized.from),
        to: formatISO(normalized.to),
      };
    }
  }
}

const TIMEFRAME_PARSE_PATTERNS = [
  'M/d/yy',
  'M/d/yyyy',
  'M/d/yy h:mm a',
  'M/d/yyyy h:mm a',
  'M/d/yy h:mma',
  'M/d/yyyy h:mma',
  'M/d/yy HH:mm',
  'M/d/yyyy HH:mm',
  'MM/dd/yy',
  'MM/dd/yyyy',
  'MM/dd/yy h:mm a',
  'MM/dd/yyyy h:mm a',
  'MM/dd/yy HH:mm',
  'MM/dd/yyyy HH:mm',
];

export function parseTimeframeInput(value: string, fallback: Date): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  for (const pattern of TIMEFRAME_PARSE_PATTERNS) {
    const parsed = parse(trimmed, pattern, fallback);
    if (isValid(parsed)) {
      return appDatePartsToDate({
        year: parsed.getFullYear(),
        month: parsed.getMonth() + 1,
        day: parsed.getDate(),
        hour: parsed.getHours(),
        minute: parsed.getMinutes(),
        second: 0,
      });
    }
  }

  const nativeDate = new Date(trimmed);
  return isValid(nativeDate) ? nativeDate : null;
}

export const PRESET_LABELS: Record<PresetKey, string> = {
  '1h': 'Last 1h',
  '6h': 'Last 6h',
  '12h': 'Last 12h',
  '24h': 'Last 24h',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last year',
  lifetime: 'Lifetime',
};

function parseStoredCustomRange(fromRaw: string, toRaw: string): DateRange | null {
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (!isValid(from) || !isValid(to)) return null;
  return normalizeDateRange({ from, to });
}

function formatRangeDisplay(value: Date) {
  return formatAppDateTime(value);
}
