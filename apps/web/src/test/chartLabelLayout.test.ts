import { describe, expect, it } from 'vitest';
import { selectAdaptiveAxisLabelIndices, selectValueLabelIndices } from '../../../../packages/ui/src/charts/chartLabelLayout';

describe('chart label layout', () => {
  it('keeps sparse axis endpoints', () => {
    expect(selectAdaptiveAxisLabelIndices(['Jan 1', 'Jan 2', 'Jan 3'], [0, 120, 240])).toEqual([0, 1, 2]);
  });

  it('bounds dense axis labels and keeps endpoints where possible', () => {
    const labels = Array.from({ length: 120 }, (_, index) => `Jul ${index + 1}`);
    const positions = labels.map((_, index) => index * 6);
    const selected = selectAdaptiveAxisLabelIndices(labels, positions);
    expect(selected[0]).toBe(0);
    expect(selected.at(-1)).toBe(119);
    expect(selected.length).toBeLessThan(labels.length);
    expect(selected.every((index, offset) => offset === 0 || (positions[index] ?? 0) - (positions[selected[offset - 1] ?? 0] ?? 0) >= 12)).toBe(true);
  });

  it('selects highest values first with stable equal-value ordering and padding', () => {
    const selected = selectValueLabelIndices([
      { index: 0, value: 10, x: 40, y: 80, width: 24 },
      { index: 1, value: 100, x: 40, y: 80, width: 24 },
      { index: 2, value: 100, x: 100, y: 80, width: 24 },
      { index: 3, value: 5, x: 200, y: 80, width: 24 },
    ]);
    expect(selected).toEqual([1, 2, 3]);
  });

  it('handles narrow and extreme candidates without throwing', () => {
    expect(selectAdaptiveAxisLabelIndices(['1', '1000000'], [0, 1])).toEqual([0]);
    expect(selectValueLabelIndices([{ index: 0, value: Number.MAX_VALUE, x: 0, y: 0, width: 10 }])).toEqual([0]);
  });
});
