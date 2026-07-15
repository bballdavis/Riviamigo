export type CurveSmoothness = 'straight' | 'gentle' | 'smooth';

export const CURVE_SMOOTHNESS_OPTIONS: ReadonlyArray<{ value: CurveSmoothness; label: string }> = [
  { value: 'straight', label: 'Straight' },
  { value: 'gentle', label: 'Gentle' },
  { value: 'smooth', label: 'Smooth' },
];

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

export function curveTension(smoothness: CurveSmoothness): number {
  return smoothness === 'smooth' ? 0.34 : 0.18;
}

export function clampedControlPoints(
  points: CurvePoint[],
  index: number,
  smoothness: CurveSmoothness,
): [CurvePoint, CurvePoint] {
  const first = points[index]!;
  const second = points[index + 1]!;
  const before = points[Math.max(0, index - 1)]!;
  const after = points[Math.min(points.length - 1, index + 2)]!;
  const tension = curveTension(smoothness);
  const minY = Math.min(first.y, second.y);
  const maxY = Math.max(first.y, second.y);
  return [
    {
      x: first.x + (second.x - before.x) * tension,
      y: Math.min(maxY, Math.max(minY, first.y + (second.y - before.y) * tension)),
    },
    {
      x: second.x - (after.x - first.x) * tension,
      y: Math.min(maxY, Math.max(minY, second.y - (after.y - first.y) * tension)),
    },
  ];
}
