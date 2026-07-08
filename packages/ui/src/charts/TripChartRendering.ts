import * as React from 'react';
import { getUnitPreferences } from '../lib/utils';

type HasElapsed = { elapsed_s: number };

type SampleDotStyle = {
  fill: string;
  r: number;
  strokeWidth: number;
};

type SampleDotProps = {
  cx?: number;
  cy?: number;
  payload?: { elapsed_s?: number | null };
  value?: number | null;
};

export const TRIP_MARKER_FULL_THRESHOLD = 120;
export const TRIP_MARKER_TARGET_COUNT = 75;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundDown(value: number, step: number) {
  return Math.floor(value / step) * step;
}

function roundUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function toDisplayTemperature(celsius: number, temperatureUnit: 'fahrenheit' | 'celsius') {
  return temperatureUnit === 'fahrenheit' ? celsius * 9 / 5 + 32 : celsius;
}

function fromDisplayTemperature(value: number, temperatureUnit: 'fahrenheit' | 'celsius') {
  return temperatureUnit === 'fahrenheit' ? (value - 32) * 5 / 9 : value;
}

export function getVisibleSampleElapsedSet<T extends HasElapsed>(
  data: readonly T[],
  hasValue: (point: T) => boolean,
  fullMarkerThreshold = TRIP_MARKER_FULL_THRESHOLD,
  targetMarkerCount = TRIP_MARKER_TARGET_COUNT,
) {
  const measured = data.filter(hasValue);
  if (measured.length === 0) return new Set<number>();
  if (measured.length <= fullMarkerThreshold) {
    return new Set(measured.map((point) => point.elapsed_s));
  }

  const stride = Math.max(1, Math.ceil(measured.length / targetMarkerCount));
  return new Set(
    measured
      .filter((_, index) => index === 0 || index === measured.length - 1 || index % stride === 0)
      .map((point) => point.elapsed_s),
  );
}

export function createSampleDotRenderer(
  visibleElapsedSet: ReadonlySet<number>,
  style: SampleDotStyle,
) {
  return function SampleDot({ cx, cy, payload, value }: SampleDotProps) {
    if (!isFiniteNumber(cx) || !isFiniteNumber(cy) || !isFiniteNumber(value)) return null;

    const elapsed = payload?.elapsed_s;
    if (!isFiniteNumber(elapsed) || !visibleElapsedSet.has(elapsed)) return null;

    return React.createElement('circle', {
      cx,
      cy,
      fill: style.fill,
      r: style.r,
      strokeWidth: style.strokeWidth,
    });
  };
}

export function getTripTemperatureDomain(
  valuesCelsius: readonly (number | null | undefined)[],
  temperatureUnit: 'fahrenheit' | 'celsius' = getUnitPreferences().temperature_unit,
) {
  const measuredValues = valuesCelsius.filter(isFiniteNumber);
  if (measuredValues.length === 0) return null;

  const displayValues = measuredValues.map((value) => toDisplayTemperature(value, temperatureUnit));
  const minDisplay = Math.min(...displayValues);
  const maxDisplay = Math.max(...displayValues);
  const displaySpan = Math.max(1, maxDisplay - minDisplay);
  const displayStep = temperatureUnit === 'fahrenheit' ? 5 : 2;

  const lowerDisplayBound = roundDown(minDisplay, displayStep);
  const upperDisplayBound = roundUp(
    maxDisplay + Math.max(displaySpan * 0.15, displayStep),
    displayStep,
  );

  return [
    fromDisplayTemperature(lowerDisplayBound, temperatureUnit),
    fromDisplayTemperature(upperDisplayBound, temperatureUnit),
  ] as const;
}
