export type CurveSmoothness = 'straight' | 'gentle' | 'smooth';

export const CURVE_SMOOTHNESS_OPTIONS: ReadonlyArray<{ value: CurveSmoothness; label: string }> = [
  { value: 'straight', label: 'Straight' },
  { value: 'gentle', label: 'Gentle' },
  { value: 'smooth', label: 'Smooth' },
];

/**
 * `gentle` and `smooth` are kept as stored values for saved dashboards and
 * chart definitions, and both draw the same shape-preserving curve. Only
 * `straight` draws differently.
 */
export const DEFAULT_CURVE_SMOOTHNESS: CurveSmoothness = 'gentle';

export function normalizeCurveSmoothness(value: unknown, fallback: CurveSmoothness = DEFAULT_CURVE_SMOOTHNESS): CurveSmoothness {
  if (value === 'straight' || value === 'gentle' || value === 'smooth') return value;
  if (value === false || value === 0) return 'straight';
  if (value === true || (typeof value === 'number' && Number.isFinite(value) && value > 0)) return 'gentle';
  return fallback;
}

export function curveSmoothnessLabel(value: CurveSmoothness): string {
  return CURVE_SMOOTHNESS_OPTIONS.find((option) => option.value === value)?.label ?? 'Gentle';
}

export interface CurvePoint {
  x: number;
  y: number;
}

export function splitCurveSegments(points: Array<CurvePoint | null>): CurvePoint[][] {
  const segments: CurvePoint[][] = [];
  let current: CurvePoint[] = [];
  for (const point of points) {
    if (!point) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Slope at every point of a shape-preserving (monotone) cubic curve.
 *
 * This is the same curve uPlot's native spline draws for the rich charts, so a
 * sparkline and a full chart bend the same way. Where the data rises or falls
 * through a point the slope is the weighted harmonic mean of the two
 * neighbouring segment slopes; at a peak, dip or plateau it is zero. That keeps
 * the curve between each pair of recorded values: it never rises above or
 * dips below them.
 */
export function monotoneCurveSlopes(points: CurvePoint[]): number[] {
  const count = points.length;
  if (count < 2) return points.map(() => 0);
  const widths: number[] = [];
  const secants: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const width = points[index + 1]!.x - points[index]!.x;
    widths.push(width);
    secants.push(width > 0 ? (points[index + 1]!.y - points[index]!.y) / width : 0);
  }
  const slopes = new Array<number>(count);
  slopes[0] = secants[0]!;
  slopes[count - 1] = secants[count - 2]!;
  for (let index = 1; index < count - 1; index += 1) {
    const before = secants[index - 1]!;
    const after = secants[index]!;
    if (before === 0 || after === 0 || (before > 0) !== (after > 0)) {
      slopes[index] = 0;
      continue;
    }
    const widthBefore = widths[index - 1]!;
    const widthAfter = widths[index]!;
    slopes[index] = 3 * (widthBefore + widthAfter)
      / ((2 * widthAfter + widthBefore) / before + (widthAfter + 2 * widthBefore) / after);
  }
  return slopes;
}

/**
 * Bezier handles for the segment from `points[index]` to `points[index + 1]`,
 * using slopes from `monotoneCurveSlopes`. A segment with no width, such as two
 * samples at one instant, falls back to a straight line.
 */
export function monotoneControlPoints(
  points: CurvePoint[],
  slopes: number[],
  index: number,
): [CurvePoint, CurvePoint] {
  const first = points[index]!;
  const second = points[index + 1]!;
  const width = second.x - first.x;
  if (!(width > 0)) return [{ ...first }, { ...second }];
  return [
    { x: first.x + width / 3, y: first.y + (slopes[index] ?? 0) * width / 3 },
    { x: second.x - width / 3, y: second.y - (slopes[index + 1] ?? 0) * width / 3 },
  ];
}
