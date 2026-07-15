import { describe, expect, it } from 'vitest';
import { seriesToDailyDeltas, seriesToDailyTotals } from '../../../../packages/dashboards/src/editor/dailyDelta';

describe('daily sensor sprite preparation', () => {
  it('sums raw event rows per day for trip-style totals', () => {
    expect(seriesToDailyTotals([
      { ts: '2026-07-01T08:00:00Z', value: 1 },
      { ts: '2026-07-01T17:00:00Z', value: 1 },
      { ts: '2026-07-02T08:00:00Z', value: 1 },
    ], 0)).toEqual([
      { ts: '2026-07-01T00:00:00.000Z', value: 2 },
      { ts: '2026-07-02T00:00:00.000Z', value: 1 },
    ]);
  });

  it('keeps cumulative readings on delta semantics', () => {
    expect(seriesToDailyDeltas([
      { ts: '2026-07-01T08:00:00Z', value: 100 },
      { ts: '2026-07-02T08:00:00Z', value: 112 },
    ], 0)).toEqual([
      { ts: '2026-07-01T08:00:00Z', value: 0 },
      { ts: '2026-07-02T08:00:00Z', value: 12 },
    ]);
  });
});
