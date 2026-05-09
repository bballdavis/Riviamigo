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
  smoothing?: number | undefined;
  yRange?: [number, number] | undefined;
  stepInterpolation?: boolean | undefined;
  xSplits?: number[] | undefined;
}

function toSeconds(value: string | number | Date) {
  if (typeof value === 'number') return value > 10_000_000_000 ? value / 1000 : value;
  return Math.floor(new Date(value).getTime() / 1000);
}

function formatDateForSpan(seconds: number, spanSeconds: number) {
  const d = new Date(seconds * 1000);
  if (spanSeconds <= 6 * 3600) {
    return d.toLocaleString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (spanSeconds <= 3 * 86400) {
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' });
  }
  if (spanSeconds <= 90 * 86400) {
    return d.toLocaleString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleString([], { month: 'short', year: '2-digit' });
}

function formatDateFallback(seconds: number) {
  return formatDateForSpan(seconds, 30 * 86400);
}

function formatValue(value: number | null | undefined, unit?: string) {
  if (value == null || !Number.isFinite(value)) return '-';
  const formatted = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatNumericAxis(value: number, unit?: string) {
  const formatted = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return unit ? `${formatted} ${unit}` : formatted;
}

function estimateYLabelWidth(labels: string[]): number {
  let maxLen = 4;
  for (const label of labels) {
    if (label.length > maxLen) maxLen = label.length;
  }
  return Math.min(maxLen * 7 + 16, 110);
}

function smoothSeries(values: Array<number | null>, alpha: number): Array<number | null> {
  if (alpha <= 0) return values;
  const window = Math.max(2, Math.round(2 + alpha * 10));
  const result: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) { result.push(null); continue; }
    let sum = 0;
    let count = 0;
    const half = Math.floor(window / 2);
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      if (values[j] != null) { sum += values[j]!; count++; }
    }
    result.push(count > 0 ? sum / count : null);
  }
  return result;
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
  smoothing = 0,
  yRange,
  stepInterpolation = false,
  xSplits,
}: RichTimeSeriesChartProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<uPlot | null>(null);
  const [tooltip, setTooltip] = React.useState<{ left: number; top: number; text: string } | null>(null);
  const [hiddenKeys, setHiddenKeys] = React.useState<Set<string>>(() => new Set());

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

  const smoothingAmount = smoothing ?? 0;

  const alignedData = React.useMemo<AlignedData>(() => {
    const x = points.map((point) => xTime ? toSeconds(point.ts) : Number(point.ts));
    const seriesData = series.map((item) => {
      const raw = item.values.map((value) => value ?? null);
      const seriesMode = item.mode ?? mode;
      if (smoothingAmount > 0 && (seriesMode === 'line' || seriesMode === 'area')) {
        return smoothSeries(raw, smoothingAmount);
      }
      return raw;
    });
    return [x, ...seriesData] as AlignedData;
  }, [points, series, xTime, smoothingAmount, mode]);
  alignedDataRef.current = alignedData;

  const hasData = alignedData.length > 1 && (alignedData[0]?.length ?? 0) > 0;
  const showLegend = series.length > 0;
  const chartHeight = Math.max(120, height - (showLegend ? 34 : 0));
  const hiddenKeySignature = React.useMemo(() => [...hiddenKeys].sort().join('|'), [hiddenKeys]);

  const structureKey = React.useMemo(
    () =>
      `${chartHeight}|${xTime}|${xUnit ?? ''}|${mode}|${smoothingAmount}|${stepInterpolation}|` +
      `${yRange ? yRange.join(',') : ''}|${xSplits ? xSplits.join(',') : ''}|` +
      series.map((s) => `${s.key}:${s.label}:${s.mode ?? ''}:${s.color ?? ''}`).join('|') +
      `|${hiddenKeySignature}`,
    [chartHeight, xTime, xUnit, mode, smoothingAmount, stepInterpolation, yRange, xSplits, series, hiddenKeySignature],
  );

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

    const width = Math.max(320, root.clientWidth || 320);

    const xValues = alignedDataRef.current[0] as number[];
    const xSpan = xValues.length > 1 ? (xValues[xValues.length - 1]! - xValues[0]!) : 86400;

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
        if (seriesMode === 'bar') {
          const barCount = xValues.length;
          const maxBarPx = barCount > 30 ? 40 : barCount > 15 ? 60 : 80;
          next.paths = uPlot.paths.bars!({ size: [0.64, maxBarPx] });
        }
        if (seriesMode === 'scatter') next.paths = () => null;
        if (stepInterpolation && (seriesMode === 'line' || seriesMode === 'area')) {
          next.paths = uPlot.paths.stepped!({ align: 1 });
        } else if (smoothingAmount > 0 && (seriesMode === 'line' || seriesMode === 'area')) {
          const spline = uPlot.paths.spline?.();
          if (spline) next.paths = spline;
        }
        return next;
      }),
    ];

    const isBarChart = series.some((s) => (s.mode ?? mode) === 'bar');

    const yScaleConfig: uPlot.Scale = {
      auto: !yRange,
      ...(yRange
        ? { range: () => yRange }
        : isBarChart
          ? { range: (_u: uPlot, dmin: number, dmax: number) => [Math.min(0, dmin), Math.max(0, dmax)] as [number, number] }
          : {}),
    };

    const xAxisConfig: uPlot.Axis = {
      stroke: CHART_COLORS.muted,
      grid: { stroke: CHART_COLORS.grid, width: 1 },
      font: `${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
      size: isBarChart ? 54 : 44,
      gap: 6,
      ...(xSplits
        ? { splits: () => xSplits }
        : {}),
      values: (_u, vals) => {
        if (xValueFormatterRef.current) {
          return vals.map((v) => xValueFormatterRef.current!(v));
        }
        if (xTimeRef.current) {
          return vals.map((v) => formatDateForSpan(v, xSpan));
        }
        return vals.map((v) => formatNumericAxis(v, xUnitRef.current));
      },
    };

    const yAxisConfig: uPlot.Axis = {
      stroke: CHART_COLORS.muted,
      grid: { stroke: CHART_COLORS.grid, width: 1 },
      font: `${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
      size: (_self, values) => {
        if (!values || values.length === 0) return 50;
        return estimateYLabelWidth(values as string[]);
      },
      gap: 8,
      values: (_u, vals) => vals.map((v) => yValueFormatterRef.current(v, yUnitRef.current)),
    };

    const opts: Options = {
      width,
      height: chartHeight,
      data: alignedDataRef.current,
      padding: [10, 14, 0, 0],
      cursor: {
        drag: { x: true, y: false },
        points: { size: 6 },
      },
      legend: { show: false },
      scales: {
        x: { time: xTime },
        y: yScaleConfig,
      },
      axes: [xAxisConfig, yAxisConfig],
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

            let tooltipHeader = '';
            if (timestamp != null) {
              if (xValueFormatterRef.current) {
                tooltipHeader = xValueFormatterRef.current(timestamp as number);
              } else if (xTimeRef.current) {
                tooltipHeader = formatDateFallback(timestamp as number);
              } else {
                tooltipHeader = formatNumericAxis(timestamp as number, xUnitRef.current);
              }
            }

            setTooltip({
              left: Math.min(Math.max((u.cursor.left ?? 0) + 16, 12), Math.max(12, u.width - 180)),
              top: Math.max((u.cursor.top ?? 0) + 12, 12),
              text: [tooltipHeader, ...rows].filter(Boolean).join('\n'),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, loading, hasData]);

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
