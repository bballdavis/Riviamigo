import React from 'react';
import { CHART_COLORS } from './ChartProvider';
import {
  bucketTimeSeriesValues,
  DEFAULT_SPRITE_TIME_FILTER,
  filterTimeSeriesValues,
  normalizeTimeFilter,
  type TimeFilterWindow,
} from './timeFilter';
import {
  clampedControlPoints,
  DEFAULT_CURVE_SMOOTHNESS,
  normalizeCurveSmoothness,
  splitCurveSegments,
  type CurvePoint,
  type CurveSmoothness,
} from './curveSmoothness';

export type MiniSparklineType = 'none' | 'line' | 'area' | 'bar';

export interface MiniSparklineProps {
  data: Array<{ ts?: string; value: number | null | undefined }>;
  type?: MiniSparklineType;
  height?: number;
  color?: string;
  showFallback?: boolean;
  timeFilter?: TimeFilterWindow;
  smoothness?: CurveSmoothness;
}

export function MiniSparkline({
  data,
  type = 'line',
  height = 42,
  color = CHART_COLORS.accent,
  showFallback = true,
  timeFilter = DEFAULT_SPRITE_TIME_FILTER,
  smoothness = DEFAULT_CURVE_SMOOTHNESS,
}: MiniSparklineProps) {
  if (type === 'none') return null;

  const chartData = data
    .map((point, index) => ({
      x: point.ts ?? String(index),
      value: Number.isFinite(point.value) ? point.value as number : null,
    }));

  if (!chartData.some((point) => point.value != null)) {
    return showFallback ? <EmptySparkline height={height} color={color} /> : null;
  }

  const resolvedFilter = normalizeTimeFilter(timeFilter, DEFAULT_SPRITE_TIME_FILTER);
  const filteredValues = filterTimeSeriesValues(
    chartData.map((point) => point.x),
    chartData.map((point) => point.value),
    resolvedFilter,
  );
  const filteredData = chartData.map((point, index) => ({ ...point, value: filteredValues[index]! }));

  if (type === 'bar') {
    const bucketedData = bucketTimeSeriesValues(
      chartData.map((point) => point.x),
      chartData.map((point) => point.value),
      resolvedFilter,
    ).map((point) => ({ x: String(point.timestamp), value: point.value }));
    return (
      <CanvasSparkline
        data={bucketedData}
        type="bar"
        height={height}
        color={color}
        timeFilter={resolvedFilter}
        smoothness={normalizeCurveSmoothness(smoothness)}
      />
    );
  }

  return (
    <CanvasSparkline
      data={filteredData}
      type="line"
      height={height}
      color={color}
      fill={type === 'area'}
      timeFilter={resolvedFilter}
      smoothness={normalizeCurveSmoothness(smoothness)}
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

export function resolveCanvasColor(canvas: HTMLCanvasElement, color: string) {
  const variable = color.match(/^var\((--[^,)]+)\)$/)?.[1];
  if (!variable || typeof window === 'undefined') return color;
  return window.getComputedStyle(canvas).getPropertyValue(variable).trim() || CHART_COLORS.accent;
}

function CanvasSparkline({
  data,
  type,
  height,
  color,
  fill,
  timeFilter,
  smoothness,
}: {
  data: Array<{ x: string; value: number | null }>;
  type: Exclude<MiniSparklineType, 'none' | 'area'>;
  height: number;
  color: string;
  fill?: boolean;
  timeFilter: TimeFilterWindow;
  smoothness: CurveSmoothness;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const draw = () => {
      const width = Math.max(1, Math.round(canvas.clientWidth));
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);

      const context = canvas.getContext('2d');
      if (!context) return;
      const canvasColor = resolveCanvasColor(canvas, color);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      const values = data
        .map((point) => point.value)
        .filter((value): value is number => value != null);
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const value of values) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      const span = max - min;
      const parsedTimes = data.map((point) => Date.parse(point.x));
      const usesTime = parsedTimes.every(Number.isFinite) && parsedTimes.length > 1 && parsedTimes[0] !== parsedTimes[parsedTimes.length - 1];
      const start = usesTime ? parsedTimes[0]! : 0;
      const end = usesTime ? parsedTimes[parsedTimes.length - 1]! : Math.max(1, data.length - 1);
      const pointAt = (point: { value: number }, index: number) => ({
        x: usesTime ? ((parsedTimes[index]! - start) / (end - start)) * width : (index / Math.max(1, data.length - 1)) * width,
        y: span === 0 ? height * 0.62 : height - 4 - ((point.value - min) / span) * Math.max(1, height - 8),
      });

      if (type === 'bar') {
        const maxValue = Math.max(0, max);
        const barWidth = Math.max(1, width / data.length);
        context.fillStyle = canvasColor;
        for (let index = 0; index < data.length; index += 1) {
          const value = data[index]!.value ?? 0;
          const normalized = maxValue > 0 ? value / maxValue : 0;
          const barHeight = normalized > 0 ? Math.max(2, normalized * (height - 6)) : 1;
          context.globalAlpha = normalized > 0 ? 0.72 : 0.26;
          context.fillRect(index * barWidth + barWidth * 0.18, height - 2 - barHeight, Math.max(1, barWidth * 0.64), barHeight);
        }
        context.globalAlpha = 1;
        return;
      }

      const points = data.map((point, index) => point.value == null ? null : pointAt({ value: point.value }, index));
      const drawLinePaths = () => {
        for (const segment of splitCurveSegments(points as Array<CurvePoint | null>)) {
          context.moveTo(segment[0]!.x, segment[0]!.y);
          if (smoothness === 'straight' || segment.length < 2) {
            for (const point of segment.slice(1)) context.lineTo(point.x, point.y);
            continue;
          }
          for (let index = 0; index < segment.length - 1; index += 1) {
            const [controlOne, controlTwo] = clampedControlPoints(segment, index, smoothness);
            const point = segment[index + 1]!;
            if (typeof context.bezierCurveTo === 'function') {
              context.bezierCurveTo(controlOne.x, controlOne.y, controlTwo.x, controlTwo.y, point.x, point.y);
            } else {
              context.lineTo(point.x, point.y);
            }
          }
        }
      };
      context.strokeStyle = canvasColor;
      context.lineWidth = 1.6;
      context.lineJoin = 'round';
      context.lineCap = 'round';

      if (fill) {
        context.beginPath();
        for (const segment of splitCurveSegments(points as Array<CurvePoint | null>)) {
          const first = segment[0]!;
          const last = segment[segment.length - 1]!;
          context.moveTo(first.x, height);
          context.lineTo(first.x, first.y);
          if (smoothness === 'straight' || segment.length < 2) {
            for (const point of segment.slice(1)) context.lineTo(point.x, point.y);
          } else {
            for (let index = 0; index < segment.length - 1; index += 1) {
              const [controlOne, controlTwo] = clampedControlPoints(segment, index, smoothness);
              const point = segment[index + 1]!;
              if (typeof context.bezierCurveTo === 'function') {
                context.bezierCurveTo(controlOne.x, controlOne.y, controlTwo.x, controlTwo.y, point.x, point.y);
              } else {
                context.lineTo(point.x, point.y);
              }
            }
          }
          context.lineTo(last.x, height);
          context.closePath();
        }
        context.globalAlpha = 0.16;
        context.fillStyle = canvasColor;
        context.fill();
        context.globalAlpha = 1;
      }
      context.beginPath();
      drawLinePaths();
      context.stroke();
    };

    draw();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [color, data, fill, height, smoothness, type]);

  return (
    <div
      style={{ height, width: '100%' }}
      className="overflow-hidden"
      data-sparkline-state={data.length === 1 ? 'single' : 'series'}
      data-sparkline-renderer="canvas"
      data-sparkline-filter={timeFilter}
      data-sparkline-point-count={data.length}
      data-sparkline-aggregation={type === 'bar' && timeFilter !== 'raw' ? 'sum' : 'none'}
      data-sparkline-smoothness={smoothness}
    >
      <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} aria-hidden="true" />
    </div>
  );
}
