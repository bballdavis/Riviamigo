import * as React from 'react';
import uPlot from 'uplot';
import type { AlignedData, Options, Series } from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cn } from '../lib/utils';
import { ChartSkeleton } from '../primitives/Skeleton';
import { CHART_COLORS, CHART_FONT } from './ChartProvider';
import { formatSmartNumber } from '../lib/utils';

export interface RichSeries {
  key: string;
  label: string;
  color?: string;
  values: Array<number | null>;
  mode?: 'line' | 'area' | 'bar' | 'scatter';
  /** Which Y scale this series is drawn on. Default 'y' (left). Use 'y2' for a right axis. */
  yScale?: 'y' | 'y2';
}

export interface RichTimeSeriesChartProps {
  points: Array<{ ts: string | number | Date }>;
  series: RichSeries[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string | undefined;
  yUnit?: string | undefined;
  /** Unit label for the right Y axis (only shown when any series has yScale='y2'). */
  yRightUnit?: string | undefined;
  className?: string | undefined;
  mode?: 'line' | 'area' | 'bar' | 'scatter' | undefined;
  xTime?: boolean;
  xUnit?: string | undefined;
  xValueFormatter?: ((value: number) => string) | undefined;
  /** Secondary X axis shown at the top of the chart (same scale as primary X, different label format). */
  xSecondaryFormatter?: ((value: number) => string) | undefined;
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
    // Sub-6h: time only with minutes — e.g. "9:30 PM"
    return d.toLocaleString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (spanSeconds <= 3 * 86400) {
    // Sub-3d: date + time with minutes — e.g. "May 9, 9:30 PM"
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  if (spanSeconds <= 90 * 86400) {
    return d.toLocaleString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleString([], { month: 'short', year: '2-digit' });
}

function formatValue(value: number | null | undefined, unit?: string) {
  if (value == null || !Number.isFinite(value)) return '-';
  if (unit === '%') return `${Math.round(value)}%`;
  const formatted = formatSmartNumber(value, Math.abs(value) >= 100 ? 0 : 1);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatNumericAxis(value: number, unit?: string) {
  const formatted = unit === '%' ? `${Math.round(value)}` : formatSmartNumber(value, Math.abs(value) >= 100 ? 0 : 1);
  return unit ? `${formatted} ${unit}` : formatted;
}

function estimateYLabelWidth(labels: string[]): number {
  let maxLen = 4;
  for (const label of labels) {
    if (label.length > maxLen) maxLen = label.length;
  }
  return Math.min(maxLen * 7 + 16, 110);
}

function createVariableSplinePathBuilder(smoothingAmount: number): uPlot.Series.PathBuilder {
  const blend = Math.max(0, Math.min(1, smoothingAmount));

  return (self, seriesIdx, idx0, idx1) =>
    uPlot.orient(
      self,
      seriesIdx,
      (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim, moveTo, lineTo, _rect, _arc, bezierCurveTo) => {
        const stroke = new Path2D();
        const fill = series.fill != null ? new Path2D() : null;
        const baselineValue =
          typeof series.fillTo === 'function'
            ? series.fillTo(self, seriesIdx, series.min ?? 0, series.max ?? 0)
            : (series.fillTo ?? 0);
        const baselineY = valToPosY(baselineValue, scaleY, yDim, yOff);

        const segments: Array<Array<{ x: number; y: number }>> = [];
        let currentSegment: Array<{ x: number; y: number }> = [];

        for (let index = idx0; index <= idx1; index += 1) {
          const yValue = dataY[index];
          if (yValue == null) {
            if (currentSegment.length > 0) {
              segments.push(currentSegment);
              currentSegment = [];
            }
            continue;
          }

          currentSegment.push({
            x: valToPosX(dataX[index]!, scaleX, xDim, xOff),
            y: valToPosY(yValue, scaleY, yDim, yOff),
          });
        }

        if (currentSegment.length > 0) {
          segments.push(currentSegment);
        }

        for (const segment of segments) {
          drawSmoothedSegment(stroke, segment, blend, moveTo, lineTo, bezierCurveTo);

          if (fill) {
            drawSmoothedSegment(fill, segment, blend, moveTo, lineTo, bezierCurveTo);
            lineTo(fill, segment[segment.length - 1]!.x, baselineY);
            lineTo(fill, segment[0]!.x, baselineY);
            fill.closePath();
          }
        }

        return {
          stroke,
          fill,
          clip: null,
          band: null,
          gaps: null,
          flags: 0,
        };
      },
    );
}

function drawSmoothedSegment(
  path: Path2D,
  points: Array<{ x: number; y: number }>,
  blend: number,
  moveTo: uPlot.MoveToH | uPlot.MoveToV,
  lineTo: uPlot.LineToH | uPlot.LineToV,
  bezierCurveTo: uPlot.BezierCurveToH | uPlot.BezierCurveToV,
) {
  if (points.length === 0) return;

  moveTo(path, points[0]!.x, points[0]!.y);

  if (points.length === 1) {
    lineTo(path, points[0]!.x, points[0]!.y);
    return;
  }

  if (points.length === 2 || blend <= 0) {
    for (let index = 1; index < points.length; index += 1) {
      lineTo(path, points[index]!.x, points[index]!.y);
    }
    return;
  }

  const tangents = computeMonotoneTangents(points);

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]!;
    const next = points[index + 1]!;
    const dx = next.x - current.x;

    if (!Number.isFinite(dx) || Math.abs(dx) < 1e-6) {
      lineTo(path, next.x, next.y);
      continue;
    }

    const linearCp1 = {
      x: current.x + dx / 3,
      y: current.y + (next.y - current.y) / 3,
    };
    const linearCp2 = {
      x: next.x - dx / 3,
      y: next.y - (next.y - current.y) / 3,
    };
    const monotoneCp1 = {
      x: current.x + dx / 3,
      y: current.y + (tangents[index]! * dx) / 3,
    };
    const monotoneCp2 = {
      x: next.x - dx / 3,
      y: next.y - (tangents[index + 1]! * dx) / 3,
    };

    bezierCurveTo(
      path,
      lerp(linearCp1.x, monotoneCp1.x, blend),
      lerp(linearCp1.y, monotoneCp1.y, blend),
      lerp(linearCp2.x, monotoneCp2.x, blend),
      lerp(linearCp2.y, monotoneCp2.y, blend),
      next.x,
      next.y,
    );
  }
}

function computeMonotoneTangents(points: Array<{ x: number; y: number }>) {
  const tangents = new Array<number>(points.length).fill(0);

  if (points.length < 2) return tangents;

  const secants = new Array<number>(points.length - 1).fill(0);
  for (let index = 0; index < points.length - 1; index += 1) {
    const dx = points[index + 1]!.x - points[index]!.x;
    secants[index] = Math.abs(dx) < 1e-6 ? 0 : (points[index + 1]!.y - points[index]!.y) / dx;
  }

  tangents[0] = secants[0]!;
  tangents[points.length - 1] = secants[secants.length - 1]!;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = secants[index - 1]!;
    const next = secants[index]!;
    tangents[index] = previous === 0 || next === 0 || previous * next < 0 ? 0 : (previous + next) / 2;
  }

  for (let index = 0; index < secants.length; index += 1) {
    const secant = secants[index]!;
    if (secant === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }

    const alpha = tangents[index]! / secant;
    const beta = tangents[index + 1]! / secant;
    const magnitude = alpha * alpha + beta * beta;

    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * alpha * secant;
      tangents[index + 1] = scale * beta * secant;
    }
  }

  return tangents;
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

export function RichTimeSeriesChart({
  points,
  series,
  height = 280,
  loading = false,
  emptyTitle = 'No chart data',
  yUnit,
  yRightUnit,
  className,
  mode = 'line',
  xTime = true,
  xUnit,
  xValueFormatter,
  xSecondaryFormatter,
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
  const yRightUnitRef = React.useRef(yRightUnit);
  const yValueFormatterRef = React.useRef(yValueFormatter);
  const xTimeRef = React.useRef(xTime);
  const xUnitRef = React.useRef(xUnit);
  const xValueFormatterRef = React.useRef(xValueFormatter);
  const xSecondaryFormatterRef = React.useRef(xSecondaryFormatter);
  const alignedDataRef = React.useRef<AlignedData>([[], []]);
  seriesRef.current = series;
  yUnitRef.current = yUnit;
  yRightUnitRef.current = yRightUnit;
  yValueFormatterRef.current = yValueFormatter;
  xTimeRef.current = xTime;
  xUnitRef.current = xUnit;
  xValueFormatterRef.current = xValueFormatter;
  xSecondaryFormatterRef.current = xSecondaryFormatter;

  const smoothingAmount = smoothing ?? 0;

  const alignedData = React.useMemo<AlignedData>(() => {
    const x = points.map((point) => xTime ? toSeconds(point.ts) : Number(point.ts));
    const seriesData = series.map((item) => item.values.map((value) => value ?? null));
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
      `${xSecondaryFormatter ? '1' : '0'}|${yRightUnit ?? ''}|` +
      series.map((s) => `${s.key}:${s.label}:${s.mode ?? ''}:${s.color ?? ''}:${s.yScale ?? ''}`).join('|') +
      `|${hiddenKeySignature}`,
    [chartHeight, xTime, xUnit, mode, smoothingAmount, stepInterpolation, yRange, xSplits, xSecondaryFormatter, yRightUnit, series, hiddenKeySignature],
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

    const hasRightAxis = seriesRef.current.some((s) => s.yScale === 'y2');

    const makeUSeries = (): Series[] => [
      {},
      ...seriesRef.current.map((item, index) => {
        const color = item.color ?? (index === 0 ? CHART_COLORS.accent : CHART_COLORS.emerald);
        const seriesMode = item.mode ?? mode;
        const hidden = hiddenKeys.has(item.key);
        const next: Series = {
          label: item.label,
          show: !hidden,
          stroke: color,
          scale: item.yScale ?? 'y',
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
          next.paths = createVariableSplinePathBuilder(smoothingAmount);
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
      font: `${CHART_FONT.fontWeight} ${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
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

    const xSecondaryAxisConfig: uPlot.Axis | null = xSecondaryFormatterRef.current
      ? {
          scale: 'x', // share the primary X scale
          side: 0,    // top
          stroke: CHART_COLORS.muted,
          grid: { show: false }, // avoid duplicate grid lines
          font: `${CHART_FONT.fontWeight} ${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
          size: 40,
          gap: 6,
          // Limit to ≤7 evenly spaced ticks so time labels don't crowd each other
          // regardless of how many data-point splits the primary axis uses.
          splits: (_u, _axisIdx, scaleMin, scaleMax) => {
            const count = 7;
            const step = (scaleMax - scaleMin) / (count - 1);
            return Array.from({ length: count }, (_, i) => scaleMin + i * step);
          },
          values: (_u, vals) =>
            vals.map((v) => xSecondaryFormatterRef.current!(v)),
        }
      : null;

    const yAxisConfig: uPlot.Axis = {
      stroke: CHART_COLORS.muted,
      grid: { stroke: CHART_COLORS.grid, width: 1 },
      font: `${CHART_FONT.fontWeight} ${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
      size: (_self, values) => {
        if (!values || values.length === 0) return 50;
        return estimateYLabelWidth(values as string[]);
      },
      gap: 8,
      values: (_u, vals) => vals.map((v) => yValueFormatterRef.current(v, yUnitRef.current)),
    };

    // Right Y axis — only added when at least one series uses scale 'y2'.
    const rightYAxisConfig: uPlot.Axis | null = hasRightAxis
      ? {
          scale: 'y2',
          side: 1, // right
          stroke: CHART_COLORS.muted,
          grid: { show: false },
          font: `${CHART_FONT.fontWeight} ${CHART_FONT.fontSize}px ${CHART_FONT.fontFamily}`,
          size: (_self, values) => {
            if (!values || values.length === 0) return 50;
            return estimateYLabelWidth(values as string[]);
          },
          gap: 8,
          values: (_u, vals) =>
            vals.map((v) => yValueFormatterRef.current(v, yRightUnitRef.current)),
        }
      : null;

    // When a secondary top axis is present we need extra top padding so its
    // labels are not clipped; otherwise keep the default small gutter.
    const topPadding = xSecondaryAxisConfig ? 44 : 10;

    const allAxes: uPlot.Axis[] = [xAxisConfig, yAxisConfig];
    if (xSecondaryAxisConfig) allAxes.push(xSecondaryAxisConfig);
    if (rightYAxisConfig) allAxes.push(rightYAxisConfig);

    const opts: Options = {
      width,
      height: chartHeight,
      data: alignedDataRef.current,
      // Keep a small left gutter so y-axis labels are not clipped at narrow widths.
      // Right gutter grows when a right axis is present so its labels aren't clipped.
      padding: [topPadding, hasRightAxis ? 4 : 14, 0, 10],
      cursor: {
        drag: { x: true, y: false },
        points: { size: 6 },
      },
      legend: { show: false },
      scales: {
        x: { time: xTime },
        y: yScaleConfig,
        ...(hasRightAxis ? { y2: { auto: true } } : {}),
      },
      axes: allAxes,
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
                // Use the right-axis unit for y2 series, primary unit for y series.
                const unit = item.yScale === 'y2' ? yRightUnitRef.current : yUnitRef.current;
                return `${item.label}: ${yValueFormatterRef.current(value, unit)}`;
              })
              .filter((row): row is string => Boolean(row));

            let tooltipHeader = '';
            let tooltipSubHeader = '';
            if (timestamp != null) {
              if (xValueFormatterRef.current) {
                tooltipHeader = xValueFormatterRef.current(timestamp as number);
              } else if (xTimeRef.current) {
                // Use actual data span so tooltip granularity matches axis labels.
                const xs = u.data[0] as number[];
                const span = xs.length > 1 ? xs[xs.length - 1]! - xs[0]! : 86400;
                tooltipHeader = formatDateForSpan(timestamp as number, span);
              } else {
                tooltipHeader = formatNumericAxis(timestamp as number, xUnitRef.current);
              }
              if (xSecondaryFormatterRef.current) {
                tooltipSubHeader = xSecondaryFormatterRef.current(timestamp as number);
              }
            }

            setTooltip({
              left: Math.min(Math.max((u.cursor.left ?? 0) + 16, 12), Math.max(12, u.width - 180)),
              top: Math.max((u.cursor.top ?? 0) + 12, 12),
              text: [tooltipHeader, tooltipSubHeader, ...rows].filter(Boolean).join('\n'),
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
          className="pointer-events-none absolute z-10 whitespace-pre rounded-md border border-border-strong bg-bg-surface px-2.5 py-1.5 text-[11px] leading-[1.5] text-fg shadow-xl"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {tooltip.text}
        </div>
      ) : null}
      {showLegend ? (
        <div className="flex h-[34px] shrink-0 items-center justify-center gap-3 border-t border-border/60 px-3 text-[11px] text-fg-tertiary">
          {series.map((item, index) => {
            const color = item.color ?? (index === 0 ? CHART_COLORS.accent : CHART_COLORS.emerald);
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
