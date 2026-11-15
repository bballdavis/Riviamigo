import { describe, expect, it } from 'vitest';
import { bucketTimeSeriesValues, filterTimeSeriesValues } from '@riviamigo/ui/charts';

describe('time-series display filtering', () => {
  const timestamps = [
    '2026-07-01T00:00:00Z',
    '2026-07-01T00:10:00Z',
    '2026-07-01T00:20:00Z',
    '2026-07-01T00:30:00Z',
  ];

  it('keeps every sample at its recorded timestamp while applying a centered window', () => {
    expect(filterTimeSeriesValues(timestamps, [0, 20, 40, 60], '1h')).toEqual([30, 30, 30, 30]);
  });

  it('never lets a rising series overshoot or fall back, such as an odometer after a drive', () => {
    // A drive of dense rising readings, then a parked stretch of sparse flat ones.
    const ts: number[] = [];
    const miles: number[] = [];
    let t = Date.UTC(2026, 10, 14, 12);
    let odometer = 23_590;
    for (let i = 0; i < 120; i += 1) { ts.push(t); miles.push(odometer); t += 30_000; odometer += 0.1; }
    for (let i = 0; i < 20; i += 1) { ts.push(t); miles.push(odometer); t += 15 * 60_000; }
    for (const window of ['15m', '1h', '6h', '24h'] as const) {
      const smoothed = filterTimeSeriesValues(ts, miles, window) as number[];
      for (let i = 1; i < smoothed.length; i += 1) {
        expect(smoothed[i]!, `${window} at ${i}`).toBeGreaterThanOrEqual(smoothed[i - 1]! - 1e-9);
      }
      expect(Math.max(...smoothed), window).toBeLessThanOrEqual(Math.max(...miles) + 1e-9);
    }
  });

  it('averages the raw samples in each window', () => {
    const minutes = [0, 10, 20, 30, 40].map((m) => Date.UTC(2026, 6, 1, 0, m));
    // 15 min reaches 7.5 minutes each side, so every point stands alone.
    expect(filterTimeSeriesValues(minutes, [0, 10, 20, 30, 40], '15m')).toEqual([0, 10, 20, 30, 40]);
    // 1 hr reaches 30 minutes each side: the first point averages 0-30, the second 0-40.
    expect(filterTimeSeriesValues(minutes, [0, 10, 20, 30, 40], '1h')).toEqual([15, 20, 20, 20, 25]);
  });

  it('leaves raw samples and null gaps intact', () => {
    expect(filterTimeSeriesValues(timestamps, [0, null, 40, 60], 'raw')).toEqual([0, null, 40, 60]);
    expect(filterTimeSeriesValues(timestamps, [0, null, 40, 60], '1h')).toEqual([0, null, 50, 50]);
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
