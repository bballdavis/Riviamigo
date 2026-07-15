import React from 'react';
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
    return <CanvasSparkline data={chartData} type="bar" height={height} color={color} />;
  }

  return (
    <CanvasSparkline
      data={chartData}
      type="line"
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

function CanvasSparkline({
  data,
  type,
  height,
  color,
  fill,
  curveSmoothing,
}: {
  data: Array<{ x: string; value: number }>;
  type: Exclude<MiniSparklineType, 'none' | 'area'>;
  height: number;
  color: string;
  fill?: boolean;
  curveSmoothing?: number;
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
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      const values = data.map((point) => point.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
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
        const maxValue = Math.max(0, ...values);
        const barWidth = Math.max(1, width / data.length);
        context.fillStyle = color;
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
      context.strokeStyle = color;
      context.lineWidth = 1.6;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });

      if (fill) {
        context.lineTo(width, height);
        context.lineTo(0, height);
        context.closePath();
        context.globalAlpha = 0.16;
        context.fillStyle = color;
        context.fill();
        context.globalAlpha = 1;
        context.beginPath();
        points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
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
      data-sparkline-curve={curveSmoothing && curveSmoothing > 0 && data.length >= 3 ? 'smooth' : 'straight'}
      data-sparkline-smoothing={(curveSmoothing ?? 0).toFixed(2)}
    >
      <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} aria-hidden="true" />
    </div>
  );
}
