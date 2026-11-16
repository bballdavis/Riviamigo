import { type CurveSmoothness } from './curveSmoothness';
import { TIME_FILTER_OPTIONS, type TimeFilterWindow } from './timeFilter';

/**
 * The one smoothing choice a chart offers, from least to most smoothed:
 *
 * - `off`: recorded values joined by straight lines.
 * - `curve`: recorded values joined by a rounded line.
 * - a time window: values averaged over that window, joined by a rounded line.
 *
 * Averaging evens out a line across its points and the curve rounds it between
 * them. Dense series need the first and sparse series the second, so one scale
 * drives both rather than asking which kind of series is on screen.
 */
export type ChartSmoothingLevel = 'off' | 'curve' | Exclude<TimeFilterWindow, 'raw'>;

export interface ChartSmoothingSupport {
  /** The chart has a time axis, so values can be averaged over a window. */
  timeWindows: boolean;
  /** The chart draws lines or areas, so the path between points can be rounded. */
  curve: boolean;
}

export interface ChartSmoothingOption {
  value: ChartSmoothingLevel;
  label: string;
  description: string;
}

const OFF_OPTION: ChartSmoothingOption = {
  value: 'off',
  label: 'Off',
  description: 'Recorded values, joined by straight lines.',
};

const CURVE_OPTION: ChartSmoothingOption = {
  value: 'curve',
  label: 'Curve',
  description: 'Recorded values, joined by a rounded line.',
};

/** The levels a chart can offer, in order from least to most smoothed. */
export function chartSmoothingOptions(support: ChartSmoothingSupport): ChartSmoothingOption[] {
  if (!support.timeWindows && !support.curve) return [];
  const options = [OFF_OPTION];
  if (support.curve) options.push(CURVE_OPTION);
  if (support.timeWindows) {
    for (const window of TIME_FILTER_OPTIONS) {
      if (window.value === 'raw') continue;
      options.push({
        value: window.value,
        label: window.label,
        description: support.curve
          ? `Averaged over ${window.label}, joined by a rounded line.`
          : `Averaged over ${window.label}.`,
      });
    }
  }
  return options;
}

/** Reads the stored time filter and curve settings as one smoothing level. */
export function resolveChartSmoothingLevel(
  timeFilter: TimeFilterWindow,
  smoothness: CurveSmoothness,
  support: ChartSmoothingSupport,
): ChartSmoothingLevel {
  if (support.timeWindows && timeFilter !== 'raw') return timeFilter;
  return support.curve && smoothness !== 'straight' ? 'curve' : 'off';
}

/** The time filter and curve settings to store for a smoothing level. */
export function chartSmoothingSettings(
  level: ChartSmoothingLevel,
): { timeFilter: TimeFilterWindow; smoothness: CurveSmoothness } {
  if (level === 'off') return { timeFilter: 'raw', smoothness: 'straight' };
  if (level === 'curve') return { timeFilter: 'raw', smoothness: 'gentle' };
  return { timeFilter: level, smoothness: 'gentle' };
}

export function chartSmoothingLabel(level: ChartSmoothingLevel): string {
  if (level === 'off') return OFF_OPTION.label;
  if (level === 'curve') return CURVE_OPTION.label;
  return TIME_FILTER_OPTIONS.find((option) => option.value === level)?.label ?? OFF_OPTION.label;
}
