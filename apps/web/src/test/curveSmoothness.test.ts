import { describe, expect, it } from 'vitest';
import {
  clampedControlPoints,
  CURVE_SMOOTHNESS_OPTIONS,
  curveSmoothnessLabel,
  normalizeCurveSmoothness,
  splitCurveSegments,
} from '@riviamigo/ui/charts';

describe('curve smoothness', () => {
  it('keeps all three persisted settings and legacy normalization behavior', () => {
    expect(CURVE_SMOOTHNESS_OPTIONS).toEqual([
      { value: 'straight', label: 'Straight' },
      { value: 'gentle', label: 'Gentle' },
      { value: 'smooth', label: 'Smooth' },
    ]);
    expect(normalizeCurveSmoothness('straight')).toBe('straight');
    expect(normalizeCurveSmoothness('gentle')).toBe('gentle');
    expect(normalizeCurveSmoothness('smooth')).toBe('smooth');
    expect(normalizeCurveSmoothness(false)).toBe('straight');
    expect(normalizeCurveSmoothness(0)).toBe('straight');
    expect(normalizeCurveSmoothness(true)).toBe('gentle');
    expect(normalizeCurveSmoothness(0.4)).toBe('gentle');
    expect(curveSmoothnessLabel('smooth')).toBe('Smooth');
  });

  it('preserves null gaps as separate curve segments', () => {
    const segments = splitCurveSegments([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      null,
      { x: 4, y: 3 },
    ]);
    expect(segments).toEqual([
      [{ x: 0, y: 1 }, { x: 1, y: 2 }],
      [{ x: 4, y: 3 }],
    ]);
  });

  it('keeps lightweight canvas control points bounded to neighboring values', () => {
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
