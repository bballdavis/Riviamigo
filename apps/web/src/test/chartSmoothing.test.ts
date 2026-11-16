import { describe, expect, it } from 'vitest';
import {
  chartSmoothingLabel,
  chartSmoothingOptions,
  chartSmoothingSettings,
  resolveChartSmoothingLevel,
} from '@riviamigo/ui/charts';

describe('chart smoothing levels', () => {
  const lineOnTime = { timeWindows: true, curve: true };
  const lineOnly = { timeWindows: false, curve: true };

  it('orders the levels from recorded values to the widest window', () => {
    expect(chartSmoothingOptions(lineOnTime).map((option) => option.value)).toEqual([
      'off', 'curve', '15m', '1h', '6h', '24h', '3d', '7d',
    ]);
    expect(chartSmoothingOptions(lineOnly).map((option) => option.value)).toEqual(['off', 'curve']);
    expect(chartSmoothingOptions({ timeWindows: false, curve: false })).toEqual([]);
  });

  it('reads stored time filter and curve settings as one level', () => {
    expect(resolveChartSmoothingLevel('raw', 'straight', lineOnTime)).toBe('off');
    expect(resolveChartSmoothingLevel('raw', 'gentle', lineOnTime)).toBe('curve');
    expect(resolveChartSmoothingLevel('raw', 'smooth', lineOnTime)).toBe('curve');
    expect(resolveChartSmoothingLevel('6h', 'gentle', lineOnTime)).toBe('6h');
    // A window stored with a straight line still reads as that window.
    expect(resolveChartSmoothingLevel('6h', 'straight', lineOnTime)).toBe('6h');
    // Without a time axis the stored window cannot apply.
    expect(resolveChartSmoothingLevel('6h', 'gentle', lineOnly)).toBe('curve');
    expect(resolveChartSmoothingLevel('6h', 'straight', lineOnly)).toBe('off');
  });

  it('stores every level as settings that read back as the same level', () => {
    expect(chartSmoothingSettings('off')).toEqual({ timeFilter: 'raw', smoothness: 'straight' });
    expect(chartSmoothingSettings('curve')).toEqual({ timeFilter: 'raw', smoothness: 'gentle' });
    expect(chartSmoothingSettings('24h')).toEqual({ timeFilter: '24h', smoothness: 'gentle' });
    for (const option of chartSmoothingOptions(lineOnTime)) {
      const stored = chartSmoothingSettings(option.value);
      expect(resolveChartSmoothingLevel(stored.timeFilter, stored.smoothness, lineOnTime)).toBe(option.value);
      expect(chartSmoothingLabel(option.value)).toBe(option.label);
    }
  });
});
