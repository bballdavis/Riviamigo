import { describe, expect, it } from 'vitest';
import { filterTimeSeriesValues } from '@riviamigo/ui/charts';

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

  it('leaves raw samples and null gaps intact', () => {
    expect(filterTimeSeriesValues(timestamps, [0, null, 40, 60], 'raw')).toEqual([0, null, 40, 60]);
    expect(filterTimeSeriesValues(timestamps, [0, null, 40, 60], '1h')).toEqual([0, null, 50, 50]);
  });
});
