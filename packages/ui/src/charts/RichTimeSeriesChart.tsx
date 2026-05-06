import * as React from 'react';
import uPlot from 'uplot';
import type { AlignedData, Options, Series } from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cn } from '../lib/utils';
import { ChartSkeleton } from '../primitives/Skeleton';
import { CHART_COLORS, CHART_FONT } from './ChartProvider';

export interface RichSeries {
  key: string;
  label: string;
  color?: string;
  values: Array<number | null>;
}

export interface RichTimeSeriesChartProps {
  points: Array<{ ts: string | number | Date }>;
  series: RichSeries[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string;
  yUnit?: string;
  className?: string;
  mode?: 'line' | 'area' | 'bar';
}

function toSeconds(value: string | number | Date) {
  if (typeof value === 'number') return value > 10_000_000_000 ? value / 1000 : value;
  return Math.floor(new Date(value).getTime() / 1000);
}

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  });
}

function formatValue(value: number | null | undefined, unit?: string) {
  if (value == null || !Number.isFinite(value)) return '-';
  const formatted = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function RichTimeSeriesChart({
  points,
  series,
  height = 280,
  loading = false,
  emptyTitle = 'No chart data',
  yUnit,
  className,
  mode = 'line',
}: RichTimeSeriesChartProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<uPlot | null>(null);
  const [tooltip, setTooltip] = React.useState<{ left: number; top: number; text: string } | null>(null);

  const alignedData = React.useMemo<AlignedData>(() => {
    const x = points.map((point) => toSeconds(point.ts));
    return [x, ...series.map((item) => item.values.map((value) => value ?? null))] as AlignedData;
  }, [points, series]);

  const hasData = alignedData.length > 1 && (alignedData[0]?.length ?? 0) > 0;

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || loading || !hasData) return undefined;

    const makeOptions = (): Options => {
      const width = Math.max(320, root.clientWidth || 320);
      const uSeries: Series[] = [
        {},
        ...series.map((item, index) => {
          const color = item.color ?? (index === 0 ? CHART_COLORS.accent : CHART_COLORS.sky);
          const next: Series = {
            label: item.label,
            stroke: color,
            width: 2,
          };
          if (mode === 'area') next.fill = `${color}22`;
          if (mode === 'bar') next.paths = uPlot.paths.bars!({ size: [0.64, Infinity] });
          return next;
        }),
      ];

      return {
        width,
        height,
        data: alignedData,
        padding: [10, 12, 4, 4],
        cursor: {
          drag: { x: true, y: false },
          points: { size: 6 },
        },
        legend: { show: false },
        scales: { x: { time: true }, y: { auto: true } },
        axes: [
          {
            stroke: CHART_COLORS.muted,
            grid: { stroke: CHART_COLORS.grid, width: 1 },
            font: `${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
            values: (_u, vals) => vals.map((v) => formatDate(v)),
          },
          {
            stroke: CHART_COLORS.muted,
            grid: { stroke: CHART_COLORS.grid, width: 1 },
            font: `${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
            values: (_u, vals) => vals.map((v) => formatValue(v, yUnit)),
          },
        ],
        series: uSeries,
        hooks: {
          setCursor: [
            (u) => {
              const idx = u.cursor.idx;
              if (idx == null || idx < 0) {
                setTooltip(null);
                return;
              }
              const timestamp = alignedData[0]?.[idx];
              const rows = series.map((item, seriesIndex) => {
                const value = alignedData[seriesIndex + 1]?.[idx] as number | null | undefined;
                return `${item.label}: ${formatValue(value, yUnit)}`;
              });
              setTooltip({
                left: Math.min(Math.max((u.cursor.left ?? 0) + 16, 12), Math.max(12, u.width - 180)),
                top: Math.max((u.cursor.top ?? 0) + 12, 12),
                text: [timestamp ? formatDate(timestamp as number) : '', ...rows].filter(Boolean).join('\n'),
              });
            },
          ],
        },
      };
    };

    chartRef.current = new uPlot(makeOptions(), alignedData, root);

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          chartRef.current?.setSize({ width: Math.max(320, root.clientWidth || 320), height });
        })
      : null;
    observer?.observe(root);

    return () => {
      observer?.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
      setTooltip(null);
    };
  }, [alignedData, hasData, height, loading, mode, series, yUnit]);

  if (loading) return <ChartSkeleton height={height} />;

  if (!hasData) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-lg border border-border bg-bg-elevated/50 text-sm text-fg-tertiary', className)}
        style={{ height }}
      >
        {emptyTitle}
      </div>
    );
  }

  return (
    <div className={cn('relative min-w-0 overflow-hidden rounded-lg border border-border bg-bg-elevated/40', className)}>
      <div ref={rootRef} className="rich-uplot-chart w-full" style={{ height }} />
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 whitespace-pre rounded-md border border-border bg-bg px-2 py-1 text-[11px] leading-4 text-fg-secondary shadow-lg"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </div>
  );
}
