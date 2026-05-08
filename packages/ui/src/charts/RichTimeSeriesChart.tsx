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

  // Stable refs so setCursor hook never needs to be re-registered to see latest values.
  const seriesRef = React.useRef(series);
  const yUnitRef = React.useRef(yUnit);
  const yValueFormatterRef = React.useRef(yValueFormatter);
  const xTimeRef = React.useRef(xTime);
  const xUnitRef = React.useRef(xUnit);
  const xValueFormatterRef = React.useRef(xValueFormatter);
  const alignedDataRef = React.useRef<AlignedData>([[], []]);
  seriesRef.current = series;
  yUnitRef.current = yUnit;
  yValueFormatterRef.current = yValueFormatter;
  xTimeRef.current = xTime;
  xUnitRef.current = xUnit;
  xValueFormatterRef.current = xValueFormatter;

  const alignedData = React.useMemo<AlignedData>(() => {
    const x = points.map((point) => xTime ? toSeconds(point.ts) : Number(point.ts));
    return [x, ...series.map((item) => item.values.map((value) => value ?? null))] as AlignedData;
  }, [points, series, xTime]);
  alignedDataRef.current = alignedData;

  const hasData = alignedData.length > 1 && (alignedData[0]?.length ?? 0) > 0;
  const showLegend = series.length > 0;
  const chartHeight = Math.max(120, height - (showLegend ? 34 : 0));
  const hiddenKeySignature = React.useMemo(() => [...hiddenKeys].sort().join('|'), [hiddenKeys]);

  // Stable key describing chart structure — rebuild uPlot only when this changes.
  const structureKey = React.useMemo(
    () =>
      `${chartHeight}|${xTime}|${xUnit ?? ''}|${mode}|` +
      series.map((s) => `${s.key}:${s.label}:${s.mode ?? ''}:${s.color ?? ''}`).join('|') +
      `|${hiddenKeySignature}`,
    [chartHeight, xTime, xUnit, mode, series, hiddenKeySignature],
  );

  React.useEffect(() => {
    setHiddenKeys((current) => {
      const validKeys = new Set(series.map((item) => item.key));
      const next = new Set([...current].filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [series]);

  // Full rebuild when structure changes.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || loading || !hasData) return undefined;

    const width = Math.max(320, root.clientWidth || 320);

    const makeUSeries = (): Series[] => [
      {},
      ...seriesRef.current.map((item, index) => {
        const color = item.color ?? (index === 0 ? CHART_COLORS.accent : CHART_COLORS.sky);
        const seriesMode = item.mode ?? mode;
        const hidden = hiddenKeys.has(item.key);
        const next: Series = {
          label: item.label,
          show: !hidden,
          stroke: color,
          width: seriesMode === 'scatter' ? 0 : 2,
          points: {
            show: seriesMode === 'scatter',
            size: 6,
            stroke: color,
            fill: color,
          },
        };
        if (seriesMode === 'area') next.fill = `${color}22`;
        if (seriesMode === 'bar') next.paths = uPlot.paths.bars!({ size: [0.64, 80] });
        if (seriesMode === 'scatter') next.paths = () => null;
        return next;
      }),
    ];

    const isBarChart = series.some((s) => (s.mode ?? mode) === 'bar');

    const opts: Options = {
      width,
      height: chartHeight,
      data: alignedDataRef.current,
      padding: [10, 12, 4, 4],
      cursor: {
        drag: { x: true, y: false },
        points: { size: 6 },
      },
      legend: { show: false },
      scales: {
        x: { time: xTime },
        y: {
          auto: true,
          ...(isBarChart ? { range: (_u, dmin, dmax) => [Math.min(0, dmin), Math.max(0, dmax)] } : {}),
        },
      },
      axes: [
        {
          stroke: CHART_COLORS.muted,
          grid: { stroke: CHART_COLORS.grid, width: 1 },
          font: `${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
          values: (_u, vals) =>
            vals.map((v) => formatXAxisValue(v, xTimeRef.current, xValueFormatterRef.current, xUnitRef.current)),
        },
        {
          stroke: CHART_COLORS.muted,
          grid: { stroke: CHART_COLORS.grid, width: 1 },
          font: `${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
          values: (_u, vals) => vals.map((v) => yValueFormatterRef.current(v, yUnitRef.current)),
        },
      ],
      series: makeUSeries(),
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              setTooltip(null);
              return;
            }
            const data = alignedDataRef.current;
            const currentSeries = seriesRef.current;
            const timestamp = data[0]?.[idx];
            const rows = currentSeries
              .map((item, seriesIndex) => {
                if (hiddenKeys.has(item.key)) return null;
                const value = data[seriesIndex + 1]?.[idx] as number | null | undefined;
                return `${item.label}: ${yValueFormatterRef.current(value, yUnitRef.current)}`;
              })
              .filter((row): row is string => Boolean(row));
            setTooltip({
              left: Math.min(Math.max((u.cursor.left ?? 0) + 16, 12), Math.max(12, u.width - 180)),
              top: Math.max((u.cursor.top ?? 0) + 12, 12),
              text: [
                timestamp != null
                  ? formatXAxisValue(timestamp as number, xTimeRef.current, xValueFormatterRef.current, xUnitRef.current)
                  : '',
                ...rows,
              ]
                .filter(Boolean)
                .join('\n'),
            });
          },
        ],
      },
    };

    chartRef.current = new uPlot(opts, alignedDataRef.current, root);

    const observer =
      typeof ResizeObserver !== 'undefined'
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
    // structureKey encodes all structural deps; hiddenKeys used inside closure but captured via structureKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, loading, hasData]);

  // Data-only update — avoids destroying/recreating uPlot on every data fetch.
  React.useEffect(() => {
    if (chartRef.current && !loading && hasData) {
      chartRef.current.setData(alignedData);
    }
  }, [alignedData, loading, hasData]);

  if (loading) return <ChartSkeleton height={height} />;

  if (!hasData) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-border bg-bg-elevated/50 text-sm text-fg-tertiary',
          className,
        )}
        style={{ height }}
      >
        {emptyTitle}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-elevated/40',
        className,
      )}
      style={{ height }}
    >
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
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-bg',
                  isHidden && 'opacity-45',
                )}
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
