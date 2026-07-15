import { describe, expect, it } from 'vitest';
import {
  clampedControlPoints,
  curveSmoothnessLabel,
  normalizeCurveSmoothness,
  splitCurveSegments,
} from '@riviamigo/ui/charts';

describe('curve smoothness', () => {
  it('normalizes the new values and legacy smoothing values', () => {
    expect(normalizeCurveSmoothness('straight')).toBe('straight');
    expect(normalizeCurveSmoothness('smooth')).toBe('smooth');
    expect(normalizeCurveSmoothness(0)).toBe('straight');
    expect(normalizeCurveSmoothness(0.4)).toBe('gentle');
    expect(curveSmoothnessLabel('gentle')).toBe('Gentle');
  });

  it('preserves null gaps as separate curve segments', () => {
    const segments = splitCurveSegments([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      null,
      { x: 4, y: 3 },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(1);
  });

  it('clamps curved control points to neighboring values', () => {
    const [first, second] = clampedControlPoints(
      [
        { x: 0, y: 0 },
        { x: 1, y: 10 },
        { x: 2, y: 0 },
        { x: 3, y: 10 },
      ],
      1,
      'smooth',
    );
    expect(first.y).toBeGreaterThanOrEqual(0);
    expect(first.y).toBeLessThanOrEqual(10);
    expect(second.y).toBeGreaterThanOrEqual(0);
    expect(second.y).toBeLessThanOrEqual(10);
  });
});
