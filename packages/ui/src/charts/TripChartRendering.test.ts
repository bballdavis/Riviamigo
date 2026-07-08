import { describe, expect, it } from 'vitest';
import {
  TRIP_MARKER_FULL_THRESHOLD,
  TRIP_MARKER_TARGET_COUNT,
  getTripTemperatureDomain,
  getVisibleSampleElapsedSet,
} from './TripChartRendering';

function toFahrenheit(celsius: number) {
  return Math.round(celsius * 9 / 5 + 32);
}

describe('getVisibleSampleElapsedSet', () => {
  it('keeps all markers for small datasets', () => {
    const data = Array.from({ length: TRIP_MARKER_FULL_THRESHOLD }, (_, index) => ({
      elapsed_s: index,
      value: index,
    }));

    const visible = getVisibleSampleElapsedSet(data, (point) => point.value != null);

    expect(visible.size).toBe(TRIP_MARKER_FULL_THRESHOLD);
    expect(visible.has(0)).toBe(true);
    expect(visible.has(TRIP_MARKER_FULL_THRESHOLD - 1)).toBe(true);
  });

  it('reduces markers deterministically for dense datasets while keeping endpoints', () => {
    const denseCount = 300;
    const data = Array.from({ length: denseCount }, (_, index) => ({
      elapsed_s: index,
      value: index,
    }));

    const visible = getVisibleSampleElapsedSet(data, (point) => point.value != null);
    const stride = Math.ceil(denseCount / TRIP_MARKER_TARGET_COUNT);

    expect(visible.size).toBeLessThan(denseCount);
    expect(visible.has(0)).toBe(true);
    expect(visible.has(denseCount - 1)).toBe(true);
    expect(visible.has(stride)).toBe(true);
    expect(visible.has(stride - 1)).toBe(false);
  });
});

describe('getTripTemperatureDomain', () => {
  it('returns null when no values are present', () => {
    expect(getTripTemperatureDomain([null, undefined], 'fahrenheit')).toBeNull();
  });

  it('adds rounded fahrenheit headroom above the highest value', () => {
    const domain = getTripTemperatureDomain([21.1, 22.8, 23.9], 'fahrenheit');

    expect(domain).not.toBeNull();
    expect(toFahrenheit(domain![0])).toBe(65);
    expect(toFahrenheit(domain![1])).toBe(85);
  });

  it('adds rounded celsius headroom using celsius-friendly steps', () => {
    const domain = getTripTemperatureDomain([20, 22, 24], 'celsius');

    expect(domain).toEqual([20, 26]);
  });
});
