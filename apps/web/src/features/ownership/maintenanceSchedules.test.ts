import { describe, expect, it } from 'vitest';
import type { OwnershipMaintenanceItem } from '@riviamigo/types';
import { draftsToSchedule, timesPerYear } from './MaintenanceSchedulesSection';

const item = (interval_mi: number | null, interval_months: number | null): OwnershipMaintenanceItem => ({
  id: 'x',
  label: 'X',
  category: 'service',
  interval_mi,
  interval_months,
  cost_usd: 100,
});

describe('maintenance schedule editor', () => {
  it('paces an item by whichever interval comes first', () => {
    // 1,000 mi a month = 12,000 mi a year.
    expect(timesPerYear(item(6_000, null), 1_000)).toBe(2);
    expect(timesPerYear(item(null, 24), 1_000)).toBe(0.5);
    expect(timesPerYear(item(20_000, 6), 1_000)).toBe(2);
    expect(timesPerYear(item(3_000, 24), 1_000)).toBe(4);
  });

  it('converts drafts to a schedule and reports each field it rejects', () => {
    const good = draftsToSchedule([
      { id: 'oil', label: ' Oil ', category: 'oil', miles: '7,500', months: '12', cost: '$110' },
    ]);
    expect(good.schedule).toEqual([
      { id: 'oil', label: 'Oil', category: 'oil', interval_mi: 7_500, interval_months: 12, cost_usd: 110 },
    ]);
    const bad = draftsToSchedule([
      { id: 'a', label: '', category: 'service', miles: '', months: '', cost: '-1' },
      { id: 'b', label: 'B', category: 'service', miles: '50', months: '1.5', cost: '10' },
    ]);
    expect(bad.schedule).toBeNull();
    expect(Object.keys(bad.errors[0] ?? {}).sort()).toEqual(['cost', 'label', 'miles']);
    expect(Object.keys(bad.errors[1] ?? {}).sort()).toEqual(['miles', 'months']);
  });
});
