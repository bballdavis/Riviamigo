export const TIME_FILTER_OPTIONS = [
  { value: 'raw', label: 'Raw', milliseconds: 0 },
  { value: '15m', label: '15 min', milliseconds: 15 * 60 * 1000 },
  { value: '1h', label: '1 hr', milliseconds: 60 * 60 * 1000 },
  { value: '6h', label: '6 hr', milliseconds: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24 hr', milliseconds: 24 * 60 * 60 * 1000 },
  { value: '3d', label: '3 days', milliseconds: 3 * 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', milliseconds: 7 * 24 * 60 * 60 * 1000 },
] as const;

export type TimeFilterWindow = (typeof TIME_FILTER_OPTIONS)[number]['value'];

export const DEFAULT_SPRITE_TIME_FILTER: TimeFilterWindow = '24h';
export const DEFAULT_CHART_TIME_FILTER: TimeFilterWindow = '15m';

export function isTimeFilterWindow(value: unknown): value is TimeFilterWindow {
  return typeof value === 'string' && TIME_FILTER_OPTIONS.some((option) => option.value === value);
}

export function normalizeTimeFilter(value: unknown, fallback: TimeFilterWindow): TimeFilterWindow {
  return isTimeFilterWindow(value) ? value : fallback;
}

export function timeFilterMilliseconds(window: TimeFilterWindow): number {
  return TIME_FILTER_OPTIONS.find((option) => option.value === window)?.milliseconds ?? 0;
}

export function timeFilterLabel(window: TimeFilterWindow): string {
  return TIME_FILTER_OPTIONS.find((option) => option.value === window)?.label ?? 'Raw';
}

function toMilliseconds(value: string | number | Date): number | null {
  const milliseconds = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

/**
 * Filters contiguous finite samples with a centered, timestamp-aware moving
 * average. It keeps the original timestamps and null gaps intact.
 */
export function filterTimeSeriesValues(
  timestamps: Array<string | number | Date>,
  values: Array<number | null | undefined>,
  window: TimeFilterWindow,
): Array<number | null> {
  const result = values.map((value) => (
    typeof value === 'number' && Number.isFinite(value) ? value : null
  ));
  const windowMilliseconds = timeFilterMilliseconds(window);
  if (windowMilliseconds === 0 || timestamps.length !== values.length) return result;

  const timeValues = timestamps.map(toMilliseconds);
  const halfWindow = windowMilliseconds / 2;
  let segmentStart = 0;

  while (segmentStart < result.length) {
    while (segmentStart < result.length && (result[segmentStart] == null || timeValues[segmentStart] == null)) {
      segmentStart += 1;
    }
    if (segmentStart >= result.length) break;

    let segmentEnd = segmentStart + 1;
    while (
      segmentEnd < result.length &&
      result[segmentEnd] != null &&
      timeValues[segmentEnd] != null &&
      timeValues[segmentEnd]! >= timeValues[segmentEnd - 1]!
    ) {
      segmentEnd += 1;
    }

    let left = segmentStart;
    let right = segmentStart;
    let sum = 0;
    let count = 0;
    for (let index = segmentStart; index < segmentEnd; index += 1) {
      const center = timeValues[index]!;
      while (right < segmentEnd && timeValues[right]! <= center + halfWindow) {
        sum += result[right]!;
        count += 1;
        right += 1;
      }
      while (left < right && timeValues[left]! < center - halfWindow) {
        sum -= result[left]!;
        count -= 1;
        left += 1;
      }
      result[index] = count > 0 ? sum / count : result[index] ?? null;
    }
    segmentStart = segmentEnd;
  }

  return result;
}

export interface TimeBucketPoint {
  timestamp: string | number | Date;
  value: number;
}

/**
 * Bins finite samples into fixed, non-overlapping time windows and sums their
 * values. This is for compact bar displays, where retaining a bar per source
 * row obscures the magnitude of activity in a period. `Raw` is a strict
 * bypass that keeps every original finite sample.
 */
export function bucketTimeSeriesValues(
  timestamps: Array<string | number | Date>,
  values: Array<number | null | undefined>,
  window: TimeFilterWindow,
): TimeBucketPoint[] {
  const samples = timestamps.flatMap((timestamp, index) => {
    const value = values[index];
    return typeof value === 'number' && Number.isFinite(value)
      ? [{ timestamp, value }]
      : [];
  });
  const windowMilliseconds = timeFilterMilliseconds(window);
  if (windowMilliseconds === 0 || timestamps.length !== values.length) return samples;

  const datedSamples = samples.map((sample) => ({ ...sample, milliseconds: toMilliseconds(sample.timestamp) }));
  if (datedSamples.some((sample) => sample.milliseconds == null)) return samples;

  const buckets = new Map<number, number>();
  for (const sample of datedSamples) {
    const bucketStart = Math.floor(sample.milliseconds! / windowMilliseconds) * windowMilliseconds;
    buckets.set(bucketStart, (buckets.get(bucketStart) ?? 0) + sample.value);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestamp, value]) => ({ timestamp: new Date(timestamp).toISOString(), value }));
}
