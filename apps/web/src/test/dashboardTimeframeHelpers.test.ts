import { describe, expect, it, beforeEach } from 'vitest';

import {
  getTimeframeLabel,
  loadDashboardTimeframe,
  normalizeDateRange,
  parseTimeframeInput,
  saveDashboardTimeframe,
  serializeDashboardTimeframe,
  timeframeToQuery,
} from '../lib/dates';

describe('dashboard timeframe helpers', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('persists and restores preset, custom, and lifetime timeframes', () => {
    saveDashboardTimeframe({ kind: 'preset', preset: '7d' });
    expect(loadDashboardTimeframe()).toEqual({ kind: 'preset', preset: '7d' });

    saveDashboardTimeframe({
      kind: 'custom',
      from: new Date('2026-01-07T18:30:00Z'),
      to: new Date('2026-01-08T05:15:00Z'),
    });
    expect(loadDashboardTimeframe()).toEqual({
      kind: 'custom',
      from: new Date('2026-01-07T18:30:00Z'),
      to: new Date('2026-01-08T05:15:00Z'),
    });

    saveDashboardTimeframe({ kind: 'lifetime' });
    expect(loadDashboardTimeframe()).toEqual({ kind: 'lifetime' });
  });

  it('serializes custom ranges in normalized order', () => {
    const serialized = serializeDashboardTimeframe({
      kind: 'custom',
      from: new Date('2026-01-08T05:15:00Z'),
      to: new Date('2026-01-07T18:30:00Z'),
    }) as { kind: 'custom'; from: string; to: string };

    expect(serialized.kind).toBe('custom');
    expect(new Date(serialized.from).toISOString()).toBe('2026-01-07T18:30:00.000Z');
    expect(new Date(serialized.to).toISOString()).toBe('2026-01-08T05:15:00.000Z');
  });

  it('parses lifetime query semantics and labels consistently', () => {
    expect(timeframeToQuery({ kind: 'lifetime' })).toEqual({
      from: null,
      to: null,
      lifetime: true,
      cacheKey: 'lifetime',
    });
    expect(getTimeframeLabel({ kind: 'lifetime' })).toBe('Lifetime');
  });

  it('parses typed US date inputs and rejects invalid values', () => {
    const fallback = new Date('2026-01-01T00:00:00Z');
    const shortDate = parseTimeframeInput('1/7/25', fallback);
    const datedTime = parseTimeframeInput('1/7/2025 6:30 PM', fallback);

    expect(shortDate).not.toBeNull();
    expect(shortDate?.getFullYear()).toBe(2025);
    expect(shortDate?.getMonth()).toBe(0);
    expect(shortDate?.getDate()).toBe(7);
    expect(shortDate?.getHours()).toBe(0);
    expect(shortDate?.getMinutes()).toBe(0);

    expect(datedTime).not.toBeNull();
    expect(datedTime?.getFullYear()).toBe(2025);
    expect(datedTime?.getMonth()).toBe(0);
    expect(datedTime?.getDate()).toBe(7);
    expect(datedTime?.getHours()).toBe(18);
    expect(datedTime?.getMinutes()).toBe(30);
    expect(parseTimeframeInput('nope', fallback)).toBeNull();
  });

  it('normalizes custom ranges when from is after to', () => {
    expect(
      normalizeDateRange({
        from: new Date('2026-02-01T00:00:00Z'),
        to: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toEqual({
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-01T00:00:00Z'),
    });
  });
});
