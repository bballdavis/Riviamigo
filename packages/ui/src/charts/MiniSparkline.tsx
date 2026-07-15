import React from 'react';
import { CHART_COLORS } from './ChartProvider';
import {
  DEFAULT_SPRITE_TIME_FILTER,
  filterTimeSeriesValues,
  normalizeTimeFilter,
  type TimeFilterWindow,
} from './timeFilter';

export type MiniSparklineType = 'none' | 'line' | 'area' | 'bar';

export interface MiniSparklineProps {
  data: Array<{ ts?: string; value: number | null | undefined }>;
  type?: MiniSparklineType;
  height?: number;
  color?: string;
  showFallback?: boolean;
  timeFilter?: TimeFilterWindow;
}

export function MiniSparkline({
  data,
  type = 'line',
  height = 42,
  color = CHART_COLORS.accent,
  showFallback = true,
  timeFilter = DEFAULT_SPRITE_TIME_FILTER,
}: MiniSparklineProps) {
  if (type === 'none') return null;

  const chartData = data
    .map((point, index) => ({ x: point.ts ?? String(index), value: point.value }))
    .filter((point): point is { x: string; value: number } => Number.isFinite(point.value));

  if (chartData.length === 0) {
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
    return <CanvasSparkline data={chartData} type="bar" height={height} color={color} timeFilter="raw" />;
  }

  return (
    <CanvasSparkline
      data={filteredData}
      type="line"
      height={height}
      color={color}
      fill={type === 'area'}
      timeFilter={resolvedFilter}
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

function resolveCanvasColor(canvas: HTMLCanvasElement, color: string) {
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
}: {
  data: Array<{ x: string; value: number }>;
  type: Exclude<MiniSparklineType, 'none' | 'area'>;
  height: number;
  color: string;
  fill?: boolean;
  timeFilter: TimeFilterWindow;
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

      const values = data.map((point) => point.value);
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
          const normalized = maxValue > 0 ? data[index]!.value / maxValue : 0;
          const barHeight = normalized > 0 ? Math.max(2, normalized * (height - 6)) : 1;
          context.globalAlpha = normalized > 0 ? 0.72 : 0.26;
          context.fillRect(index * barWidth + barWidth * 0.18, height - 2 - barHeight, Math.max(1, barWidth * 0.64), barHeight);
        }
        context.globalAlpha = 1;
        return;
      }

      const points = data.map(pointAt);
      const drawLinePath = () => {
        context.moveTo(points[0]!.x, points[0]!.y);
        for (let index = 1; index < points.length; index += 1) {
          context.lineTo(points[index]!.x, points[index]!.y);
        }
      };
      context.strokeStyle = canvasColor;
      context.lineWidth = 1.6;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.beginPath();
      drawLinePath();

      if (fill) {
        context.lineTo(width, height);
        context.lineTo(0, height);
        context.closePath();
        context.globalAlpha = 0.16;
        context.fillStyle = canvasColor;
        context.fill();
        context.globalAlpha = 1;
        context.beginPath();
        drawLinePath();
      }
      context.stroke();
    };

    draw();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [color, data, fill, height, type]);

  return (
    <div
      style={{ height, width: '100%' }}
      className="overflow-hidden"
      data-sparkline-state={data.length === 1 ? 'single' : 'series'}
      data-sparkline-renderer="canvas"
      data-sparkline-filter={timeFilter}
    >
      <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} aria-hidden="true" />
    </div>
  );
}
