import { describe, expect, it } from 'vitest';
import {
  CURVE_SMOOTHNESS_OPTIONS,
  curveSmoothnessLabel,
  monotoneControlPoints,
  monotoneCurveSlopes,
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

  it('keeps every curve segment between its two recorded values', () => {
    // Irregular spacing with a peak, a dip and a plateau.
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
      { x: 20, y: 30 },
      { x: 21, y: 31 },
    ];
    const slopes = monotoneCurveSlopes(points);
    for (let index = 0; index < points.length - 1; index += 1) {
      const [first, second] = monotoneControlPoints(points, slopes, index);
      const low = Math.min(points[index]!.y, points[index + 1]!.y);
      const high = Math.max(points[index]!.y, points[index + 1]!.y);
      for (const control of [first, second]) {
        expect(control.y).toBeGreaterThanOrEqual(low - 1e-9);
        expect(control.y).toBeLessThanOrEqual(high + 1e-9);
        expect(control.x).toBeGreaterThanOrEqual(points[index]!.x);
        expect(control.x).toBeLessThanOrEqual(points[index + 1]!.x);
      }
    }
  });

  it('flattens the curve at peaks, dips and plateaus so it cannot overshoot', () => {
    const slopes = monotoneCurveSlopes([
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 5 },
    ]);
    expect(slopes[1]).toBe(0);
    expect(slopes[2]).toBe(0);
    expect(slopes[3]).toBe(0);
  });

  it('keeps a straight run straight and draws two samples at one instant as a line', () => {
    const line = [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 3, y: 6 }];
    expect(monotoneCurveSlopes(line)).toEqual([2, 2, 2]);

    const stacked = [{ x: 1, y: 0 }, { x: 1, y: 8 }];
    expect(monotoneControlPoints(stacked, monotoneCurveSlopes(stacked), 0)).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 8 },
    ]);
  });
});
