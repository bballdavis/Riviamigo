import { describe, expect, it } from 'vitest';
import { bucketTimeSeriesValues, filterTimeSeriesValues } from '@riviamigo/ui/charts';

describe('time-series display filtering', () => {
  const timestamps = [
    '2026-07-01T00:00:00Z',
    '2026-07-01T00:10:00Z',
    '2026-07-01T00:20:00Z',
    '2026-07-01T00:30:00Z',
  ];

  const minute = 60_000;
  const start = Date.UTC(2026, 6, 1);
  const closeTo = (actual: Array<number | null>, expected: number[]) => {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((value, index) => expect(actual[index]!, `index ${index}`).toBeCloseTo(value, 9));
  };

  it('keeps a straight trend straight, including its first and last values', () => {
    closeTo(filterTimeSeriesValues(timestamps, [0, 20, 40, 60], '1h'), [0, 20, 40, 60]);
    // Uneven spacing must not bend it either.
    const uneven = [0, 1, 7, 8, 30, 55, 56, 120].map((m) => start + m * minute);
    closeTo(
      filterTimeSeriesValues(uneven, uneven.map((t) => (t - start) / minute * 2), '1h'),
      uneven.map((t) => (t - start) / minute * 2),
    );
  });

  it('never lets a rising series overshoot or fall back, such as an odometer after a drive', () => {
    // A drive of dense rising readings, then a parked stretch of sparse flat ones.
    const ts: number[] = [];
    const miles: number[] = [];
    let t = Date.UTC(2026, 10, 14, 12);
    let odometer = 23_590;
    for (let i = 0; i < 120; i += 1) { ts.push(t); miles.push(odometer); t += 30_000; odometer += 0.1; }
    for (let i = 0; i < 20; i += 1) { ts.push(t); miles.push(odometer); t += 15 * 60_000; }
    for (const window of ['15m', '1h', '6h', '24h', '3d', '7d'] as const) {
      const smoothed = filterTimeSeriesValues(ts, miles, window) as number[];
      for (let i = 1; i < smoothed.length; i += 1) {
        expect(smoothed[i]!, `${window} at ${i}`).toBeGreaterThanOrEqual(smoothed[i - 1]! - 1e-9);
      }
      expect(Math.max(...smoothed), window).toBeLessThanOrEqual(Math.max(...miles));
      expect(Math.min(...smoothed), window).toBeGreaterThanOrEqual(Math.min(...miles));
      // The line starts and ends on the recorded odometer, whatever the window.
      expect(smoothed[0], window).toBeCloseTo(miles[0]!, 9);
      expect(smoothed[smoothed.length - 1], window).toBeCloseTo(miles[miles.length - 1]!, 9);
    }
  });

  it('weights by elapsed time, so a burst of readings cannot outvote a long quiet stretch', () => {
    // Half-hourly readings at 0, a one-second jump to 100 recorded 100 times in
    // 100 seconds, then half-hourly readings at 100.
    const ts: number[] = [];
    const values: number[] = [];
    for (let m = 0; m <= 120; m += 30) { ts.push(start + m * minute); values.push(0); }
    const jumpIndex = ts.length - 1;
    for (let second = 1; second <= 100; second += 1) { ts.push(start + 120 * minute + second * 1000); values.push(100); }
    for (let m = 150; m <= 270; m += 30) { ts.push(start + m * minute); values.push(100); }

    const smoothed = filterTimeSeriesValues(ts, values, '1h') as number[];
    // At the jump, half the surrounding hour was at 0 and half at 100. Counting
    // samples instead would report about 98.
    expect(smoothed[jumpIndex]).toBeGreaterThan(40);
    expect(smoothed[jumpIndex]).toBeLessThan(60);
    // Well clear of the jump the line still sits on the recorded value.
    expect(smoothed[0]).toBeCloseTo(0, 9);
    expect(smoothed[smoothed.length - 1]).toBeCloseTo(100, 9);
  });

  it('evens out a noisy series without leaving its recorded range', () => {
    const ts = Array.from({ length: 200 }, (_, index) => start + index * minute);
    const noisy = ts.map((_, index) => 50 + (index % 2 === 0 ? 10 : -10));
    const roughness = (series: number[]) => series.slice(1).reduce(
      (total, value, index) => total + Math.abs(value - series[index]!),
      0,
    );
    const smoothed = filterTimeSeriesValues(ts, noisy, '15m') as number[];
    expect(roughness(smoothed)).toBeLessThan(roughness(noisy) / 20);
    expect(Math.max(...smoothed)).toBeLessThanOrEqual(60);
    expect(Math.min(...smoothed)).toBeGreaterThanOrEqual(40);
    // A wider window is smoother still.
    expect(roughness(filterTimeSeriesValues(ts, noisy, '1h') as number[])).toBeLessThan(roughness(smoothed));
  });

  it('leaves raw samples and null gaps intact', () => {
    expect(filterTimeSeriesValues(timestamps, [0, null, 40, 60], 'raw')).toEqual([0, null, 40, 60]);
    // The null ends the run, and the two samples after it are both run ends.
    const gapped = filterTimeSeriesValues(timestamps, [0, null, 40, 60], '1h');
    expect(gapped[0]).toBe(0);
    expect(gapped[1]).toBeNull();
    closeTo(gapped.slice(2), [40, 60]);
  });

  it('averages across nulls only when the chart joins its line across them', () => {
    // Two interleaved sources leave every other slot empty for this series.
    const ts = Array.from({ length: 9 }, (_, index) => start + index * 10 * minute);
    const sparse = [0, null, 100, null, 0, null, 100, null, 0];

    expect(filterTimeSeriesValues(ts, sparse, '1h')).toEqual(sparse);

    const joined = filterTimeSeriesValues(ts, sparse, '1h', { spanGaps: true });
    expect(joined.map((value) => value == null)).toEqual(sparse.map((value) => value == null));
    expect(joined[2]!).toBeLessThan(100);
    expect(joined[4]!).toBeGreaterThan(0);
    expect(joined[0]).toBeCloseTo(0, 9);
    expect(joined[8]).toBeCloseTo(0, 9);
  });

  it('does not average across a gap longer than the stated maximum', () => {
    const ts = [0, 10, 20, 500, 510, 520].map((m) => start + m * minute);
    const values = [0, 0, 0, 100, 100, 100];
    // Unbroken, the long ramp between the two groups pulls both inward.
    const unbroken = filterTimeSeriesValues(ts, values, '24h') as number[];
    expect(unbroken[2]!).toBeGreaterThan(1);
    // Broken at the gap, each group only sees itself.
    closeTo(
      filterTimeSeriesValues(ts, values, '24h', { maximumGapMilliseconds: 120 * minute }),
      [0, 0, 0, 100, 100, 100],
    );
  });

  it('starts a new run where time goes backwards instead of mixing the two', () => {
    const ts = [0, 10, 20, 5, 15, 25].map((m) => start + m * minute);
    closeTo(filterTimeSeriesValues(ts, [0, 0, 0, 100, 100, 100], '1h'), [0, 0, 0, 100, 100, 100]);
  });

  it('stays fast on a long dense series with the widest window', () => {
    const count = 200_000;
    const ts = Array.from({ length: count }, (_, index) => start + index * 30_000);
    const values = ts.map((_, index) => Math.sin(index / 500) * 40 + 50);
    const began = performance.now();
    const smoothed = filterTimeSeriesValues(ts, values, '7d');
    expect(smoothed).toHaveLength(count);
    expect(performance.now() - began).toBeLessThan(1500);
  });

  it('sums bar samples into non-overlapping time windows without changing raw samples', () => {
    const tripTimestamps = [
      '2026-07-01T00:05:00Z',
      '2026-07-01T00:55:00Z',
      '2026-07-01T01:10:00Z',
    ];

    expect(bucketTimeSeriesValues(tripTimestamps, [1, 1, 1], 'raw')).toEqual([
      { timestamp: tripTimestamps[0], value: 1 },
      { timestamp: tripTimestamps[1], value: 1 },
      { timestamp: tripTimestamps[2], value: 1 },
    ]);
    expect(bucketTimeSeriesValues(tripTimestamps, [1, 1, 1], '1h')).toEqual([
      { timestamp: '2026-07-01T00:00:00.000Z', value: 2 },
      { timestamp: '2026-07-01T01:00:00.000Z', value: 1 },
    ]);
  });
});
