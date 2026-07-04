import { describe, expect, it } from 'vitest';
import { getExplicitScaleConfig } from '../../../../packages/ui/src/charts/RichTimeSeriesChart';

describe('RichTimeSeriesChart range plumbing', () => {
  it('builds fixed scale configs for manual x, y, and y2 ranges', () => {
    const xScale = getExplicitScaleConfig([900, 3100], { time: false });
    const yScale = getExplicitScaleConfig([240, 320]);
    const yRightScale = getExplicitScaleConfig([9000, 15000]);
    const resolveRange = (range: typeof xScale.range) =>
      typeof range === 'function'
        ? (range as unknown as () => [number, number])()
        : undefined;

    expect(xScale.auto).toBe(false);
    expect(resolveRange(xScale.range)).toEqual([900, 3100]);
    expect(xScale.time).toBe(false);

    expect(yScale.auto).toBe(false);
    expect(resolveRange(yScale.range)).toEqual([240, 320]);

    expect(yRightScale.auto).toBe(false);
    expect(resolveRange(yRightScale.range)).toEqual([9000, 15000]);
  });

  it('keeps auto-ranging when no override is present', () => {
    const autoScale = getExplicitScaleConfig(undefined, { time: true });

    expect(autoScale.auto).toBe(true);
    expect(autoScale.range).toBeUndefined();
    expect(autoScale.time).toBe(true);
  });
});
