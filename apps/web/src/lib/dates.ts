import { formatISO, subDays, subHours, subMonths, startOfDay, endOfDay } from 'date-fns';

export type PresetKey = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d' | '1y';
const PRESET_KEYS: readonly PresetKey[] = ['1h', '6h', '12h', '24h', '7d', '30d', '90d', '1y'];

export interface DateRange {
  from: Date;
  to: Date;
}

export function presetToRange(preset: PresetKey): DateRange {
  const now = new Date();
  switch (preset) {
    case '1h': return { from: subHours(now, 1), to: now };
    case '6h': return { from: subHours(now, 6), to: now };
    case '12h': return { from: subHours(now, 12), to: now };
    case '24h': return { from: subDays(now, 1),          to: now };
    case '7d':  return { from: startOfDay(subDays(now, 7)),  to: endOfDay(now) };
    case '30d': return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
    case '90d': return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) };
    case '1y':  return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) };
  }
}

export function rangeToIso(range: DateRange): { from: string; to: string } {
  return {
    from: formatISO(range.from),
    to:   formatISO(range.to),
  };
}

export const DEFAULT_PRESET: PresetKey = '30d';
export const DEFAULT_RANGE = presetToRange(DEFAULT_PRESET);

const DASHBOARD_TIMEFRAME_STORAGE_KEY = 'rm-dashboard-timeframe';

type StoredDashboardTimeframe = {
  preset?: string;
  from?: string;
  to?: string;
};

export function loadDashboardTimeframe(): { preset?: PresetKey; range?: DateRange } | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_TIMEFRAME_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredDashboardTimeframe;
    if (typeof parsed?.preset === 'string' && PRESET_KEYS.includes(parsed.preset as PresetKey)) {
      return { preset: parsed.preset as PresetKey };
    }

    if (typeof parsed?.from !== 'string' || typeof parsed?.to !== 'string') return null;

    const from = new Date(parsed.from);
    const to = new Date(parsed.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;

    return { range: { from, to } };
  } catch {
    return null;
  }
}

export function saveDashboardTimeframe(preset: PresetKey | undefined, range: DateRange) {
  if (typeof window === 'undefined') return;

  try {
    const payload: StoredDashboardTimeframe = preset
      ? { preset }
      : { from: formatISO(range.from), to: formatISO(range.to) };
    window.sessionStorage.setItem(DASHBOARD_TIMEFRAME_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable or full; the picker still works in-memory.
  }
}
