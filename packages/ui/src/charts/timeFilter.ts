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

/**
 * Largest interval a compact sparkline will render as one visual observation.
 * Rich dashboard history charts do not use this guard: their valid samples
 * remain connected across elapsed time.
 */
export function maximumContinuousTimeGapMilliseconds(window: TimeFilterWindow): number {
  return Math.max(2 * 60 * 60 * 1000, timeFilterMilliseconds(window) * 4);
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

export interface TimeFilterOptions {
  /**
   * Average across null samples instead of ending the run at them. Set this
   * when the chart joins its line across gaps, so the filter smooths the same
   * line the chart draws.
   */
  spanGaps?: boolean | undefined;
  /** End a run where two neighbouring samples are further apart than this. */
  maximumGapMilliseconds?: number | undefined;
}

/**
 * Time-weighted mean of the line drawn through the samples, over a window
 * centred on each sample. `times` ascend and both arrays share one length.
 *
 * Weighting by elapsed time, not by sample count, keeps a burst of dense
 * readings (a drive) from outvoting hours of sparse ones (parked). Near either
 * end the window narrows symmetrically, so the first and last values stay on
 * the recorded data, a straight trend stays straight, and a series that only
 * rises can never be drawn falling.
 */
function timeWeightedMean(times: Float64Array, values: Float64Array, windowMilliseconds: number): Float64Array {
  const count = times.length;
  const result = new Float64Array(count);
  // integral[i] is the area under the drawn line from the first sample to sample i.
  const integral = new Float64Array(count);
  for (let index = 1; index < count; index += 1) {
    integral[index] = integral[index - 1]!
      + (times[index]! - times[index - 1]!) * (values[index]! + values[index - 1]!) / 2;
  }
  const lastIndex = count - 1;
  const end = times[lastIndex]!;
  // The window's two edges only ever move forward, so each keeps its own
  // position and the whole pass stays linear in the number of samples.
  const areaReader = () => {
    let cursor = 0;
    return (time: number): number => {
      while (cursor < lastIndex && times[cursor + 1]! <= time) cursor += 1;
      if (cursor >= lastIndex) return integral[lastIndex]!;
      const span = times[cursor + 1]! - times[cursor]!;
      const offset = time - times[cursor]!;
      if (span <= 0 || offset <= 0) return integral[cursor]!;
      const valueAtTime = values[cursor]! + (values[cursor + 1]! - values[cursor]!) * (offset / span);
      return integral[cursor]! + offset * (values[cursor]! + valueAtTime) / 2;
    };
  };
  const areaToWindowStart = areaReader();
  const areaToWindowEnd = areaReader();
  for (let index = 0; index < count; index += 1) {
    const center = times[index]!;
    const reach = Math.min(windowMilliseconds / 2, center, end - center);
    if (reach <= 0) {
      result[index] = values[index]!;
      continue;
    }
    result[index] = (areaToWindowEnd(center + reach) - areaToWindowStart(center - reach)) / (2 * reach);
  }
  return result;
}

/**
 * Smooths finite samples over a time window, keeping every original timestamp
 * and null in place.
 *
 * Each run of samples is averaged twice with a time-weighted window (see
 * `timeWeightedMean`). Two passes give a tent-shaped weighting with the same
 * spread as one moving average of the labelled width, so the result bends
 * gradually where a single pass would leave corners. Every output is an
 * average of recorded values with non-negative weights: it stays inside the
 * recorded range and cannot overshoot.
 *
 * A run ends where time goes backwards, at a null (unless `spanGaps`), or at a
 * gap longer than `maximumGapMilliseconds`.
 */
export function filterTimeSeriesValues(
  timestamps: Array<string | number | Date>,
  values: Array<number | null | undefined>,
  window: TimeFilterWindow,
  options: TimeFilterOptions = {},
): Array<number | null> {
  const raw = values.map((value) => (
    typeof value === 'number' && Number.isFinite(value) ? value : null
  ));
  const result = [...raw];
  const windowMilliseconds = timeFilterMilliseconds(window);
  if (windowMilliseconds === 0 || timestamps.length !== values.length) return result;

  const timeValues = timestamps.map(toMilliseconds);
  const passWindow = windowMilliseconds / Math.SQRT2;
  const { spanGaps = false, maximumGapMilliseconds } = options;
  let run: number[] = [];

  const smoothRun = () => {
    const indices = run;
    run = [];
    if (indices.length < 2) return;
    // Work relative to the first sample so large values such as an odometer
    // keep their precision in the running integral.
    const startTime = timeValues[indices[0]!]!;
    const base = raw[indices[0]!]!;
    const times = new Float64Array(indices.length);
    let smoothed: Float64Array = new Float64Array(indices.length);
    let lowest = 0;
    let highest = 0;
    indices.forEach((sourceIndex, position) => {
      const value = raw[sourceIndex]! - base;
      times[position] = timeValues[sourceIndex]! - startTime;
      smoothed[position] = value;
      if (value < lowest) lowest = value;
      if (value > highest) highest = value;
    });
    smoothed = timeWeightedMean(times, smoothed, passWindow);
    smoothed = timeWeightedMean(times, smoothed, passWindow);
    indices.forEach((sourceIndex, position) => {
      result[sourceIndex] = base + Math.min(highest, Math.max(lowest, smoothed[position]!));
    });
  };

  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    const time = timeValues[index];
    if (value == null || time == null) {
      if (!spanGaps || value != null) smoothRun();
      continue;
    }
    const previous = run.length > 0 ? timeValues[run[run.length - 1]!]! : null;
    if (
      previous != null
      && (time < previous || (maximumGapMilliseconds != null && time - previous > maximumGapMilliseconds))
    ) {
      smoothRun();
    }
    run.push(index);
  }
  smoothRun();

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
