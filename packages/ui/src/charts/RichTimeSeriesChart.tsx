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
  mode?: 'line' | 'area' | 'bar' | 'scatter';
}

export interface RichTimeSeriesChartProps {
  points: Array<{ ts: string | number | Date }>;
  series: RichSeries[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string | undefined;
  yUnit?: string | undefined;
  className?: string | undefined;
  mode?: 'line' | 'area' | 'bar' | 'scatter' | undefined;
  xTime?: boolean;
  xUnit?: string | undefined;
  xValueFormatter?: ((value: number) => string) | undefined;
  yValueFormatter?: ((value: number | null | undefined, unit?: string) => string) | undefined;
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

function formatXAxisValue(secondsOrValue: number, xTime: boolean, formatter?: (value: number) => string, unit?: string) {
  if (formatter) return formatter(secondsOrValue);
  if (xTime) return formatDate(secondsOrValue);
  const formatted = Math.abs(secondsOrValue) >= 100 ? secondsOrValue.toFixed(0) : secondsOrValue.toFixed(1);
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
  xTime = true,
  xUnit,
  xValueFormatter,
  yValueFormatter = formatValue,
}: RichTimeSeriesChartProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<uPlot | null>(null);
  const [tooltip, setTooltip] = React.useState<{ left: number; top: number; text: string } | null>(null);
  const [hiddenKeys, setHiddenKeys] = React.useState<Set<string>>(() => new Set());

  const alignedData = React.useMemo<AlignedData>(() => {
    const x = points.map((point) => xTime ? toSeconds(point.ts) : Number(point.ts));
    return [x, ...series.map((item) => item.values.map((value) => value ?? null))] as AlignedData;
  }, [points, series, xTime]);

  const hasData = alignedData.length > 1 && (alignedData[0]?.length ?? 0) > 0;
  const showLegend = series.length > 0;
  const chartHeight = Math.max(120, height - (showLegend ? 34 : 0));
  const hiddenKeySignature = React.useMemo(() => [...hiddenKeys].sort().join('|'), [hiddenKeys]);

  React.useEffect(() => {
    setHiddenKeys((current) => {
      const validKeys = new Set(series.map((item) => item.key));
      const next = new Set([...current].filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [series]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || loading || !hasData) return undefined;

    const makeOptions = (): Options => {
      const width = Math.max(320, root.clientWidth || 320);
      const uSeries: Series[] = [
        {},
        ...series.map((item, index) => {
          const color = item.color ?? (index === 0 ? CHART_COLORS.accent : CHART_COLORS.sky);
          const seriesMode = item.mode ?? mode;
          const next: Series = {
            label: item.label,
            show: !hiddenKeys.has(item.key),
            stroke: color,
            width: 2,
            points: { show: seriesMode === 'scatter', size: 6, stroke: color, fill: color },
          };
          if (seriesMode === 'area') next.fill = `${color}22`;
          if (seriesMode === 'bar') next.paths = uPlot.paths.bars!({ size: [0.64, Infinity] });
          if (seriesMode === 'scatter') next.width = 0;
          return next;
        }),
      ];

      return {
        width,
        height: chartHeight,
        data: alignedData,
        padding: [10, 12, 4, 4],
        cursor: {
          drag: { x: true, y: false },
          points: { size: 6 },
        },
        legend: { show: false },
        scales: { x: { time: xTime }, y: { auto: true } },
        axes: [
          {
            stroke: CHART_COLORS.muted,
            grid: { stroke: CHART_COLORS.grid, width: 1 },
            font: `${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
            values: (_u, vals) => vals.map((v) => formatXAxisValue(v, xTime, xValueFormatter, xUnit)),
          },
          {
            stroke: CHART_COLORS.muted,
            grid: { stroke: CHART_COLORS.grid, width: 1 },
            font: `${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
            values: (_u, vals) => vals.map((v) => yValueFormatter(v, yUnit)),
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
              const rows = series
                .map((item, seriesIndex) => {
                  if (hiddenKeys.has(item.key)) return null;
                  const value = alignedData[seriesIndex + 1]?.[idx] as number | null | undefined;
                  return `${item.label}: ${yValueFormatter(value, yUnit)}`;
                })
                .filter((row): row is string => Boolean(row));
              setTooltip({
                left: Math.min(Math.max((u.cursor.left ?? 0) + 16, 12), Math.max(12, u.width - 180)),
                top: Math.max((u.cursor.top ?? 0) + 12, 12),
                text: [
                  timestamp != null ? formatXAxisValue(timestamp as number, xTime, xValueFormatter, xUnit) : '',
                  ...rows,
                ].filter(Boolean).join('\n'),
              });
            },
          ],
        },
      };
    };

    chartRef.current = new uPlot(makeOptions(), alignedData, root);

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          chartRef.current?.setSize({ width: Math.max(320, root.clientWidth || 320), height: chartHeight });
        })
      : null;
    observer?.observe(root);

    return () => {
      observer?.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
      setTooltip(null);
    };
  }, [alignedData, chartHeight, hasData, hiddenKeySignature, hiddenKeys, loading, mode, series, xTime, xUnit, xValueFormatter, yUnit, yValueFormatter]);

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
    <div className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-elevated/40', className)} style={{ height }}>
      <div ref={rootRef} className="rich-uplot-chart w-full min-h-0 flex-1" style={{ height: chartHeight }} />
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 whitespace-pre rounded-md border border-border bg-bg px-2 py-1 text-[11px] leading-4 text-fg-secondary shadow-lg"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {tooltip.text}
        </div>
      ) : null}
      {showLegend ? (
        <div className="flex h-[34px] shrink-0 items-center justify-center gap-3 border-t border-border/60 px-3 text-[11px] text-fg-tertiary">
          {series.map((item, index) => {
            const color = item.color ?? (index === 0 ? CHART_COLORS.accent : CHART_COLORS.sky);
            const isHidden = hiddenKeys.has(item.key);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setHiddenKeys((current) => {
                    const next = new Set(current);
                    if (next.has(item.key)) next.delete(item.key);
                    else next.add(item.key);
                    return next;
                  });
                }}
                className={cn('flex items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-bg', isHidden && 'opacity-45')}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
