import { formatISO, subDays, subMonths, startOfDay, endOfDay } from 'date-fns';
export function presetToRange(preset) {
    const now = new Date();
    switch (preset) {
        case '24h': return { from: subDays(now, 1), to: now };
        case '7d': return { from: startOfDay(subDays(now, 7)), to: endOfDay(now) };
        case '30d': return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
        case '90d': return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) };
        case '1y': return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) };
    }
}
export function rangeToIso(range) {
    return {
        from: formatISO(range.from),
        to: formatISO(range.to),
    };
}
export const DEFAULT_PRESET = '30d';
export const DEFAULT_RANGE = presetToRange(DEFAULT_PRESET);
