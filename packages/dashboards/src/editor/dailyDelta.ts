export interface SeriesPoint {
  ts?: string;
  value: number | null | undefined;
}

export interface DailyDeltaPoint {
  ts: string;
  value: number;
}

export function seriesToDailyTotals(series: SeriesPoint[], windowDays: number): DailyDeltaPoint[] {
  const finite = series.filter(
    (point): point is { ts: string; value: number } =>
      typeof point.value === 'number' &&
      Number.isFinite(point.value) &&
      typeof point.ts === 'string' &&
      point.ts.length > 0
  );
  if (finite.length === 0) return [];

  const totalsByDay = new Map<string, number>();
  for (const point of finite) {
    const date = new Date(point.ts);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + point.value);
  }
  if (totalsByDay.size === 0) return [];

  const sortedKeys = Array.from(totalsByDay.keys()).sort();
  const totals = sortedKeys.map((key) => ({
    ts: `${key}T00:00:00.000Z`,
    value: totalsByDay.get(key)!,
  }));
  return padDailyWindow(totals, windowDays);
}

function dayKey(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function seriesToDailyDeltas(series: SeriesPoint[], windowDays: number): DailyDeltaPoint[] {
  const finite = series.filter(
    (point): point is { ts: string; value: number } =>
      typeof point.value === 'number' &&
      Number.isFinite(point.value) &&
      typeof point.ts === 'string' &&
      point.ts.length > 0
  );
  if (finite.length === 0) return [];

  finite.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const lastByDay = new Map<string, { ts: string; value: number }>();
  for (const point of finite) {
    const date = new Date(point.ts);
    if (Number.isNaN(date.getTime())) continue;
    lastByDay.set(dayKey(date), point);
  }
  if (lastByDay.size === 0) return [];

  const sortedKeys = Array.from(lastByDay.keys()).sort();
  const deltas: DailyDeltaPoint[] = [];
  let previous: number | null = null;
  for (const key of sortedKeys) {
    const last = lastByDay.get(key)!;
    if (previous == null) {
      deltas.push({ ts: last.ts, value: 0 });
    } else {
      const delta = last.value - previous;
      deltas.push({ ts: last.ts, value: delta > 0 ? delta : 0 });
    }
    previous = last.value;
  }

  return padDailyWindow(deltas, windowDays);
}

function padDailyWindow(points: DailyDeltaPoint[], windowDays: number): DailyDeltaPoint[] {
  if (windowDays <= 0 || points.length === 0) return points;

  const lastDate = startOfUtcDay(new Date(points[points.length - 1]!.ts));
  const cutoff = new Date(lastDate.getTime() - (windowDays - 1) * 86_400_000);
  const filtered = points.filter((point) => {
    const d = new Date(point.ts);
    return Number.isFinite(d.getTime()) && d.getTime() >= cutoff.getTime();
  });

  const byKey = new Map(filtered.map((point) => [dayKey(new Date(point.ts)), point]));
  const padded: DailyDeltaPoint[] = [];
  for (let i = 0; i < windowDays; i += 1) {
    const cursor = new Date(cutoff.getTime() + i * 86_400_000);
    const key = dayKey(cursor);
    padded.push(byKey.get(key) ?? { ts: cursor.toISOString(), value: 0 });
  }
  return padded;
}
