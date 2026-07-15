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
      result[index] = count > 0 ? sum / count : result[index];
    }
    segmentStart = segmentEnd;
  }

  return result;
}
