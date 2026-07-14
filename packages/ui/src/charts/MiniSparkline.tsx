import { CHART_COLORS } from './ChartProvider';

export type MiniSparklineType = 'none' | 'line' | 'area' | 'bar';

export interface MiniSparklineProps {
  data: Array<{ ts?: string; value: number | null | undefined }>;
  type?: MiniSparklineType;
  height?: number;
  color?: string;
  showFallback?: boolean;
  curveSmoothing?: number | boolean;
}

export const DEFAULT_CURVE_SMOOTHING = 0.45;

/** Normalize the shared sensor-graph curve interpolation setting. */
export function normalizeCurveSmoothing(value: unknown, fallback = DEFAULT_CURVE_SMOOTHING) {
  if (typeof value === 'boolean') return value ? fallback : 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return fallback;
}

export function MiniSparkline({
  data,
  type = 'line',
  height = 42,
  color = CHART_COLORS.accent,
  showFallback = true,
  curveSmoothing = DEFAULT_CURVE_SMOOTHING,
}: MiniSparklineProps) {
  if (type === 'none') return null;

  const chartData = data
    .map((point, index) => ({ x: point.ts ?? String(index), value: point.value }))
    .filter((point): point is { x: string; value: number } => Number.isFinite(point.value));

  if (chartData.length === 0) {
    return showFallback ? <EmptySparkline height={height} color={color} /> : null;
  }

  if (type === 'bar') {
    return <BarSparkline data={chartData} height={height} color={color} />;
  }

  return (
    <LineSparkline
      data={chartData}
      height={height}
      color={color}
      fill={type === 'area'}
      curveSmoothing={normalizeCurveSmoothing(curveSmoothing)}
    />
  );
}

function EmptySparkline({ height, color }: { height: number; color: string }) {
  return (
    <div
      style={{ height, width: '100%' }}
      className="overflow-hidden rounded"
      data-sparkline-state="empty"
    >
      <svg
        style={{ display: 'block', height: '100%', width: '100%' }}
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 28 C18 23 30 31 48 26 S78 22 100 27"
          fill="none"
          stroke={color}
          strokeWidth="1.2"
          strokeOpacity="0.22"
          strokeDasharray="3 4"
        />
      </svg>
    </div>
  );
}

function LineSparkline({
  data,
  height,
  color,
  fill,
  curveSmoothing,
}: {
  data: Array<{ value: number }>;
  height: number;
  color: string;
  fill: boolean;
  curveSmoothing: number;
}) {
  const points = normalizeLinePoints(data);
  const linePath = pointsToPath(points, curveSmoothing);
  const areaPath = `${linePath} L100 36 L0 36 Z`;

  return (
    <div
      style={{ height, width: '100%' }}
      className="overflow-hidden"
      data-sparkline-state={data.length === 1 ? 'single' : 'series'}
      data-sparkline-curve={curveSmoothing > 0 && data.length >= 3 ? 'smooth' : 'straight'}
      data-sparkline-smoothing={curveSmoothing.toFixed(2)}
    >
      <svg
        style={{ display: 'block', height: '100%', width: '100%' }}
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {fill ? <path d={areaPath} fill={color} fillOpacity="0.16" /> : null}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function BarSparkline({
  data,
  height,
  color,
}: {
  data: Array<{ value: number }>;
  height: number;
  color: string;
}) {
  const maxValue = Math.max(0, ...data.map((point) => point.value));
  const width = 100 / data.length;

  return (
    <div
      style={{ height, width: '100%' }}
      className="overflow-hidden"
      data-sparkline-state={data.length === 1 ? 'single' : 'series'}
    >
      <svg
        style={{ display: 'block', height: '100%', width: '100%' }}
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {data.map((point, index) => {
          const normalized = maxValue > 0 ? point.value / maxValue : 0;
          const barHeight = normalized > 0 ? Math.max(4, normalized * 28) : 1;
          return (
            <rect
              key={`${index}-${point.value}`}
              x={index * width + width * 0.18}
              y={34 - barHeight}
              width={Math.max(2, width * 0.64)}
              height={barHeight}
              rx="1.2"
              fill={color}
              fillOpacity={normalized > 0 ? 0.72 : 0.26}
            />
          );
        })}
      </svg>
    </div>
  );
}

function normalizeLinePoints(data: Array<{ value: number }>) {
  const expanded = data.length === 1 ? [data[0]!, data[0]!] : data;
  const values = expanded.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  return expanded.map((point, index) => {
    const x = expanded.length === 1 ? 50 : (index / (expanded.length - 1)) * 100;
    const y = span === 0 ? 22 : 32 - ((point.value - min) / span) * 24;
    return { x, y };
  });
}

function pointsToPath(points: Array<{ x: number; y: number }>, curveSmoothing: number) {
  if (points.length < 3 || curveSmoothing <= 0) {
    return straightPointsToPath(points);
  }

  const tension = curveSmoothing / 6;
  let path = `M${formatPoint(points[0]!)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const after = points[index + 2] ?? next;
    const cp1 = {
      x: current.x + (next.x - previous.x) * tension,
      y: current.y + (next.y - previous.y) * tension,
    };
    const cp2 = {
      x: next.x - (after.x - current.x) * tension,
      y: next.y - (after.y - current.y) * tension,
    };
    path += ` C${formatPoint(cp1)} ${formatPoint(cp2)} ${formatPoint(next)}`;
  }

  return path;
}

function straightPointsToPath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${formatPoint(point)}`).join(' ');
}

function formatPoint(point: { x: number; y: number }) {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}
