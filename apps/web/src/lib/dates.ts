import { formatISO, subDays, subHours, subMonths, startOfDay, endOfDay } from 'date-fns';

export type PresetKey = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d' | '1y';

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
