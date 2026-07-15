import * as React from 'react';
import uPlot from 'uplot';
import { RotateCcw } from 'lucide-react';
import type { AlignedData, Options, Series } from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cn } from '../lib/utils';
import { ChartSkeleton } from '../primitives/Skeleton';
import { CHART_BAR_STYLE, CHART_COLORS, CHART_FONT } from './ChartProvider';
import { formatNumber, formatSmartNumber } from '../lib/utils';
import { filterTimeSeriesValues, type TimeFilterWindow } from './timeFilter';
import { DEFAULT_CURVE_SMOOTHNESS, normalizeCurveSmoothness, type CurveSmoothness } from './curveSmoothness';

export interface RichSeries {
  key: string;
  label: string;
  color?: string;
  values: Array<number | null>;
  mode?: 'line' | 'area' | 'bar' | 'scatter';
  /** Marker diameter for scatter series. */
  pointSize?: number;
  /** Include values in the hover tooltip without drawing a series or legend item. */
  tooltipOnly?: boolean;
  /** Draw the series without adding another legend item. */
  showInLegend?: boolean;
  /** Formats this series in the hover tooltip, independent of the chart axis unit. */
  tooltipFormatter?: (value: number | null | undefined) => string;
  /** Optional per-point context appended to this series' hover row. */
  tooltipDetails?: Array<string | null | undefined>;
  /** Which Y scale this series is drawn on. Default 'y' (left). Use 'y2' for a right axis. */
  yScale?: 'y' | 'y2';
  /** Keep cumulative or derived supporting series raw while filtering the primary line. */
  filterable?: boolean;
  /** Opt out supporting/derived line series from display curve shaping. */
  smoothable?: boolean;
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
  /** Optional formatter for primary Y-axis tick labels. Tooltip formatting remains controlled by yValueFormatter. */
  yAxisValueFormatter?: ((value: number | null | undefined, unit?: string) => string) | undefined;
  /** Optional formatter for secondary Y-axis tick labels. Tooltip formatting remains controlled by yValueFormatter. */
  yRightAxisValueFormatter?: ((value: number | null | undefined, unit?: string) => string) | undefined;
  yValueFormatter?: ((value: number | null | undefined, unit?: string) => string) | undefined;
  timeFilter?: TimeFilterWindow | undefined;
  smoothness?: CurveSmoothness | undefined;
  xRange?: [number, number] | undefined;
  yRange?: [number, number] | undefined;
  yRightRange?: [number, number] | undefined;
  stepInterpolation?: boolean | undefined;
  xSplits?: number[] | undefined;
  /** Native uPlot cursor synchronization group for dense coordinated charts. */
  cursorSyncKey?: string | undefined;
  /** Receives the aligned sample index without forcing the chart to re-render. */
  onCursorIndexChange?: ((index: number | null) => void) | undefined;
  /** Connect line/area paths across null samples and carry the last value in tooltips. */
  connectGaps?: boolean | undefined;
  /** Enables touch-first pan and pinch exploration for a dedicated mobile chart view. */
  interactionMode?: 'standard' | 'touch-explore' | undefined;
}

export function clampExplorationRange(
  proposed: [number, number],
  bounds: [number, number],
  minimumSpan: number,
): [number, number] {
  const [boundMin, boundMax] = bounds;
  const maxSpan = boundMax - boundMin;
  if (maxSpan <= 0) return bounds;

  const span = Math.min(maxSpan, Math.max(minimumSpan, proposed[1] - proposed[0]));
  let min = proposed[0];
  let max = min + span;
  if (min < boundMin) {
    min = boundMin;
    max = min + span;
  }
  if (max > boundMax) {
    max = boundMax;
    min = max - span;
  }
  return [min, max];
}

export function isZoomedXRange(current: [number, number], full: [number, number]) {
  const tolerance = Math.max(1e-9, Math.abs(full[1] - full[0]) * 1e-6);
  return Math.abs(current[0] - full[0]) > tolerance || Math.abs(current[1] - full[1]) > tolerance;
}

function attachTouchExploration(root: HTMLDivElement, chart: uPlot, bounds: [number, number]) {
  const pointers = new Map<number, { x: number; y: number }>();
  const minimumSpan = Math.max((bounds[1] - bounds[0]) / 500, Number.EPSILON);
  let startRange: [number, number] = bounds;
  let startPoint: { x: number; y: number } | null = null;
  let pinch: { distance: number; centerX: number; range: [number, number] } | null = null;
  let lastTapAt = 0;
  const previousTouchAction = root.style.touchAction;
  root.style.touchAction = 'none';

  const currentRange = (): [number, number] => {
    const scale = chart.scales.x;
    return [scale?.min ?? bounds[0], scale?.max ?? bounds[1]];
  };
  const reset = () => chart.setScale('x', { min: bounds[0], max: bounds[1] });
  const firstTwoPoints = () => Array.from(pointers.values()).slice(0, 2) as [{ x: number; y: number }, { x: number; y: number }];

  const startPinch = () => {
    if (pointers.size < 2) return;
    const [left, right] = firstTwoPoints();
    pinch = {
      distance: Math.max(1, Math.hypot(right.x - left.x, right.y - left.y)),
      centerX: (left.x + right.x) / 2,
      range: currentRange(),
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    const now = Date.now();
    if (pointers.size === 0 && now - lastTapAt < 300) {
      reset();
      lastTapAt = 0;
    } else if (pointers.size === 0) {
      lastTapAt = now;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    root.setPointerCapture?.(event.pointerId);
    startRange = currentRange();
    startPoint = { x: event.clientX, y: event.clientY };
    startPinch();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return;

    if (pointers.size >= 2) {
      if (!pinch) startPinch();
      if (!pinch) return;
      const [left, right] = firstTwoPoints();
      const distance = Math.max(1, Math.hypot(right.x - left.x, right.y - left.y));
      const nextSpan = (pinch.range[1] - pinch.range[0]) * (pinch.distance / distance);
      const focusRatio = Math.min(1, Math.max(0, (pinch.centerX - rect.left) / rect.width));
      const focus = pinch.range[0] + (pinch.range[1] - pinch.range[0]) * focusRatio;
      const nextRange = clampExplorationRange(
        [focus - nextSpan * focusRatio, focus + nextSpan * (1 - focusRatio)],
        bounds,
        minimumSpan,
      );
      chart.setScale('x', { min: nextRange[0], max: nextRange[1] });
      event.preventDefault();
      return;
    }

    if (!startPoint) return;
    const span = startRange[1] - startRange[0];
    const delta = ((event.clientX - startPoint.x) / rect.width) * span;
    const nextRange = clampExplorationRange([startRange[0] - delta, startRange[1] - delta], bounds, minimumSpan);
    chart.setScale('x', { min: nextRange[0], max: nextRange[1] });
    event.preventDefault();
  };

  const onPointerEnd = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      const [point] = pointers.values();
      startPoint = point ?? null;
      startRange = currentRange();
    } else {
      startPoint = null;
    }
  };

  root.addEventListener('pointerdown', onPointerDown, { passive: false });
  root.addEventListener('pointermove', onPointerMove, { passive: false });
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  return () => {
    root.style.touchAction = previousTouchAction;
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
  };
}

function toSeconds(value: string | number | Date) {
  if (typeof value === 'number') return value > 10_000_000_000 ? value / 1000 : value;
  return Math.floor(new Date(value).getTime() / 1000);
}

function formatDateForSpan(seconds: number, spanSeconds: number) {
  const d = new Date(seconds * 1000);
  if (spanSeconds <= 24 * 3600) {
    // Sub-24h: time only with minutes — e.g. "9:30 PM"
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

export function getAdaptiveDecimalPrecision(values: number[], maxPrecision = 4) {
  const finiteValues = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.abs(value) < 1e-12 ? 0 : value)
    .sort((a, b) => a - b);

  if (finiteValues.length < 2) return 0;

  let minStep = Number.POSITIVE_INFINITY;
  for (let index = 1; index < finiteValues.length; index += 1) {
    const step = Math.abs(finiteValues[index]! - finiteValues[index - 1]!);
    if (step > 1e-9 && step < minStep) {
      minStep = step;
    }
  }

  if (!Number.isFinite(minStep)) return 0;

  let precision = 0;
  let scaled = minStep;
  while (precision < maxPrecision && Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    precision += 1;
    scaled *= 10;
  }

  return precision;
}

export function formatChartNumber(value: number | null | undefined, unit?: string, precision = 0) {
  if (value == null || !Number.isFinite(value)) return '-';
  const decimals = Math.max(0, precision);
  const formatted = decimals > 0 ? formatNumber(value, decimals) : formatSmartNumber(value, 0);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Carry the most recent finite reading across missing samples for tooltip display. */
export function carryForwardTooltipValues(values: Array<number | null | undefined>) {
  let lastValue: number | null = null;
  return values.map((value) => {
    if (value != null && Number.isFinite(value)) {
      lastValue = value;
    }
    return lastValue;
  });
}

export function getExplicitScaleConfig(range?: [number, number], extra: Omit<uPlot.Scale, 'auto' | 'range'> = {}): uPlot.Scale {
  return {
    ...extra,
    auto: !range,
    ...(range ? { range: () => range } : {}),
  };
}

/** uPlot takes bar radii as a fraction of bar width; keep the shared radius in pixels. */
export function getUPlotBarRadius(maxBarPx: number): [number, number] {
  return [Math.min(0.5, CHART_BAR_STYLE.radius / Math.max(1, maxBarPx)), 0];
}

function estimateYLabelWidth(labels: string[]): number {
  let maxLen = 4;
  for (const label of labels) {
    if (label.length > maxLen) maxLen = label.length;
  }
  return Math.min(maxLen * 7 + 16, 110);
}

export function buildRichTimeSeriesUPlotSeries(
  items: RichSeries[],
  {
    mode = 'line',
    barCount = 0,
    hiddenKeys = new Set<string>(),
    connectGaps = false,
    stepInterpolation = false,
    smoothness = DEFAULT_CURVE_SMOOTHNESS,
  }: {
    mode?: RichTimeSeriesChartProps['mode'];
    barCount?: number;
    hiddenKeys?: ReadonlySet<string>;
    connectGaps?: boolean;
    stepInterpolation?: boolean;
    smoothness?: CurveSmoothness;
  } = {},
): Series[] {
  return [
    {},
    ...items.map((item, index) => {
      const color = item.color ?? (index === 0 ? CHART_COLORS.accent : CHART_COLORS.emerald);
      const seriesMode = item.mode ?? mode;
      const hidden = hiddenKeys.has(item.key) || item.tooltipOnly === true;
      const next: Series = {
        label: item.label,
        show: !hidden,
        stroke: color,
        scale: item.yScale ?? 'y',
        width: seriesMode === 'scatter' ? 0 : seriesMode === 'bar' ? 1 : 2,
        points: {
          show: seriesMode === 'scatter',
          size: item.pointSize ?? 6,
          stroke: color,
          fill: color,
        },
      };
      if (seriesMode === 'area') next.fill = `${color}22`;
      if (connectGaps && (seriesMode === 'line' || seriesMode === 'area')) next.spanGaps = true;
      if (seriesMode === 'bar') {
        const maxBarPx = barCount > 30 ? 40 : barCount > 15 ? 60 : CHART_BAR_STYLE.maxWidth;
        next.fill = color;
        next.paths = uPlot.paths.bars!({
          size: [CHART_BAR_STYLE.slotRatio, maxBarPx],
          radius: getUPlotBarRadius(maxBarPx),
        });
      }
      if (seriesMode === 'scatter') next.paths = () => null;
      if (smoothness !== 'straight' && item.smoothable !== false && (seriesMode === 'line' || seriesMode === 'area')) {
        next.paths = uPlot.paths.spline!();
      } else if (stepInterpolation && (seriesMode === 'line' || seriesMode === 'area')) {
        next.paths = uPlot.paths.stepped!({ align: 1 });
      }
      return next;
    }),
  ];
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
  yAxisValueFormatter,
  yRightAxisValueFormatter,
  yValueFormatter,
  timeFilter = 'raw',
  smoothness = DEFAULT_CURVE_SMOOTHNESS,
  xRange,
  yRange,
  yRightRange,
  stepInterpolation = false,
  xSplits,
  cursorSyncKey,
  onCursorIndexChange,
  connectGaps = false,
  interactionMode = 'standard',
}: RichTimeSeriesChartProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<uPlot | null>(null);
  const [tooltip, setTooltip] = React.useState<{ left: number; top: number; text: string } | null>(null);
  const [hiddenKeys, setHiddenKeys] = React.useState<Set<string>>(() => new Set());
  const [isZoomed, setIsZoomed] = React.useState(false);

  const seriesRef = React.useRef(series);
  const yUnitRef = React.useRef(yUnit);
  const yRightUnitRef = React.useRef(yRightUnit);
  const yAxisValueFormatterRef = React.useRef(yAxisValueFormatter);
  const yRightAxisValueFormatterRef = React.useRef(yRightAxisValueFormatter);
  const yValueFormatterRef = React.useRef(yValueFormatter);
  const xTimeRef = React.useRef(xTime);
  const xUnitRef = React.useRef(xUnit);
  const xValueFormatterRef = React.useRef(xValueFormatter);
  const xSecondaryFormatterRef = React.useRef(xSecondaryFormatter);
  const onCursorIndexChangeRef = React.useRef(onCursorIndexChange);
  const tooltipValuesRef = React.useRef<Array<Array<number | null>>>([]);
  const tooltipDetailsRef = React.useRef<Array<Array<string | null | undefined>>>([]);
  const yPrecisionRef = React.useRef(0);
  const yRightPrecisionRef = React.useRef(0);
  const alignedDataRef = React.useRef<AlignedData>([[], []]);
  seriesRef.current = series;
  yUnitRef.current = yUnit;
  yRightUnitRef.current = yRightUnit;
  yAxisValueFormatterRef.current = yAxisValueFormatter;
  yRightAxisValueFormatterRef.current = yRightAxisValueFormatter;
  yValueFormatterRef.current = yValueFormatter;
  xTimeRef.current = xTime;
  xUnitRef.current = xUnit;
  xValueFormatterRef.current = xValueFormatter;
  xSecondaryFormatterRef.current = xSecondaryFormatter;
  onCursorIndexChangeRef.current = onCursorIndexChange;

  const alignedData = React.useMemo<AlignedData>(() => {
    const x = points.map((point) => xTime ? toSeconds(point.ts) : Number(point.ts));
    const seriesData = series.map((item) => (
      xTime && item.filterable !== false
        ? filterTimeSeriesValues(points.map((point) => point.ts), item.values, timeFilter)
        : item.values.map((value) => value ?? null)
    ));
    return [x, ...seriesData] as AlignedData;
  }, [points, series, timeFilter, xTime]);
  alignedDataRef.current = alignedData;
  const tooltipValues = React.useMemo<Array<Array<number | null>>>(
    () => alignedData.slice(1).map((values) => (
      connectGaps
        ? carryForwardTooltipValues(values as Array<number | null | undefined>)
        : Array.from(values as Array<number | null | undefined>, (value) => value ?? null)
    )),
    [alignedData, connectGaps],
  );
  tooltipValuesRef.current = tooltipValues;
  tooltipDetailsRef.current = series.map((item) => item.tooltipDetails ?? []);

  const hasData = alignedData.length > 1 && (alignedData[0]?.length ?? 0) > 0;
  const legendSeries = series.filter((item) => !item.tooltipOnly && item.showInLegend !== false);
  const showLegend = legendSeries.length > 0;
  const chartHeight = Math.max(120, height - (showLegend ? 34 : 0));
  const hiddenKeySignature = React.useMemo(() => [...hiddenKeys].sort().join('|'), [hiddenKeys]);

  const structureKey = React.useMemo(
    () =>
      `${chartHeight}|${xTime}|${xUnit ?? ''}|${mode}|${timeFilter}|${smoothness}|${stepInterpolation}|` +
      `${xRange ? xRange.join(',') : ''}|${yRange ? yRange.join(',') : ''}|${yRightRange ? yRightRange.join(',') : ''}|${xSplits ? xSplits.join(',') : ''}|` +
      `${xSecondaryFormatter ? '1' : '0'}|${yRightUnit ?? ''}|` +
      `${cursorSyncKey ?? ''}|${connectGaps ? 'connect-gaps' : ''}|` +
      `${interactionMode}|` +
      series.map((s) => `${s.key}:${s.label}:${s.mode ?? ''}:${s.color ?? ''}:${s.yScale ?? ''}:${s.tooltipOnly ? 'tooltip' : ''}`).join('|') +
      `|${hiddenKeySignature}`,
    [chartHeight, xTime, xUnit, mode, timeFilter, smoothness, stepInterpolation, xRange, yRange, yRightRange, xSplits, xSecondaryFormatter, yRightUnit, cursorSyncKey, connectGaps, interactionMode, series, hiddenKeySignature],
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
    const fullXRange: [number, number] = xRange ?? [xValues[0]!, xValues[xValues.length - 1]!];

    const hasRightAxis = seriesRef.current.some((s) => !s.tooltipOnly && s.yScale === 'y2');

    const isBarChart = series.some((s) => (s.mode ?? mode) === 'bar');

    const yScaleConfig: uPlot.Scale = yRange
      ? getExplicitScaleConfig(yRange)
      : isBarChart
        ? { auto: true, range: (_u: uPlot, dmin: number, dmax: number) => [Math.min(0, dmin), Math.max(0, dmax)] as [number, number] }
        : { auto: true };

    const xScaleConfig = getExplicitScaleConfig(xRange, { time: xTime });

    const rightYScaleConfig: uPlot.Scale | undefined = hasRightAxis ? getExplicitScaleConfig(yRightRange) : undefined;

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
        return vals.map((v) => formatChartNumber(v, xUnitRef.current, 0));
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
      values: (_u, vals) => {
        const precision = getAdaptiveDecimalPrecision(vals);
        yPrecisionRef.current = precision;
        return vals.map((v) => {
          if (yAxisValueFormatterRef.current) {
            return yAxisValueFormatterRef.current(v, yUnitRef.current);
          }
          if (yValueFormatterRef.current) {
            return yValueFormatterRef.current(v, yUnitRef.current);
          }
          return formatChartNumber(v, yUnitRef.current, precision);
        });
      },
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
          values: (_u, vals) => {
            const precision = getAdaptiveDecimalPrecision(vals);
            yRightPrecisionRef.current = precision;
            return vals.map((v) => {
              if (yRightAxisValueFormatterRef.current) {
                return yRightAxisValueFormatterRef.current(v, yRightUnitRef.current);
              }
              if (yValueFormatterRef.current) {
                return yValueFormatterRef.current(v, yRightUnitRef.current);
              }
              return formatChartNumber(v, yRightUnitRef.current, precision);
            });
          },
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
        drag: { x: interactionMode !== 'touch-explore', y: false },
        points: { size: 6 },
        ...(cursorSyncKey ? { sync: { key: cursorSyncKey, scales: ['x', null] } } : {}),
      },
      legend: { show: false },
      scales: {
        x: xScaleConfig,
        y: yScaleConfig,
        ...(hasRightAxis && rightYScaleConfig ? { y2: rightYScaleConfig } : {}),
      },
      axes: allAxes,
      series: buildRichTimeSeriesUPlotSeries(seriesRef.current, {
        mode,
        barCount: xValues.length,
        hiddenKeys,
        connectGaps,
        stepInterpolation,
        smoothness: normalizeCurveSmoothness(smoothness),
      }),
      hooks: {
        setScale: [
          (u, key) => {
            if (key !== 'x') return;
            const scale = u.scales.x;
            if (scale?.min == null || scale.max == null) return;
            const nextZoomed = isZoomedXRange([scale.min, scale.max], fullXRange);
            setIsZoomed((current) => current === nextZoomed ? current : nextZoomed);
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              onCursorIndexChangeRef.current?.(null);
              setTooltip(null);
              return;
            }
            onCursorIndexChangeRef.current?.(idx);
            const data = alignedDataRef.current;
            const currentSeries = seriesRef.current;
            const timestamp = data[0]?.[idx];
            const rows = currentSeries
              .map((item, seriesIndex) => {
                if (hiddenKeys.has(item.key)) return null;
                const value = tooltipValuesRef.current[seriesIndex]?.[idx] ?? null;
                const detail = tooltipDetailsRef.current[seriesIndex]?.[idx];
                const withDetail = (text: string) => detail ? `${text} (${detail})` : text;
                if (item.tooltipFormatter) {
                  return withDetail(`${item.label}: ${item.tooltipFormatter(value)}`);
                }
                // Use the right-axis unit for y2 series, primary unit for y series.
                const unit = item.yScale === 'y2' ? yRightUnitRef.current : yUnitRef.current;
                const precision = item.yScale === 'y2' ? yRightPrecisionRef.current : yPrecisionRef.current;
                if (yValueFormatterRef.current) {
                  return withDetail(`${item.label}: ${yValueFormatterRef.current(value, unit)}`);
                }
                return withDetail(`${item.label}: ${formatChartNumber(value, unit, precision)}`);
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
                tooltipHeader = formatChartNumber(timestamp as number, xUnitRef.current, 0);
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
    setIsZoomed(false);

    const chart = chartRef.current;
    const touchCleanup = interactionMode === 'touch-explore'
      ? attachTouchExploration(root, chart, fullXRange)
      : undefined;

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            chartRef.current?.setSize({ width: Math.max(320, root.clientWidth || 320), height: chartHeight });
          })
        : null;
    observer?.observe(root);

    return () => {
      observer?.disconnect();
      touchCleanup?.();
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
        'relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border',
        interactionMode === 'touch-explore' ? 'bg-bg-surface shadow-xl' : 'bg-bg-elevated/40',
        className,
      )}
      style={{ height }}
    >
      <div ref={rootRef} className="rich-uplot-chart w-full min-h-0 flex-1" style={{ height: chartHeight }} />
      {isZoomed ? (
        <button
          type="button"
          onClick={() => {
            const chart = chartRef.current;
            const values = alignedDataRef.current[0] as number[];
            if (!chart || values.length < 2) return;
            chart.setScale('x', { min: xRange?.[0] ?? values[0]!, max: xRange?.[1] ?? values[values.length - 1]! });
          }}
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-surface/95 text-fg-secondary shadow-sm transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          aria-label="Return to full chart view"
          title="Return to full chart view"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
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
          {legendSeries.map((item, index) => {
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
