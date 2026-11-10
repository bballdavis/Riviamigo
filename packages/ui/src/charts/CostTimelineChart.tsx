import * as React from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE } from './ChartProvider';

/** One sample: a timestamp plus a running balance per series id. */
export type CostTimelineRow = { t: number } & Record<string, number>;

export interface CostTimelineSeries {
  id: string;
  label: string;
  color: string;
  /** Drawn thicker and on top of the other series. */
  emphasized?: boolean;
}

/** A shaded span of the time axis, such as estimated or projected months. */
export interface CostTimelineRegion {
  fromMs: number;
  toMs: number;
  label: string;
}

export interface CostTimelineChartProps {
  /**
   * Rows in time order. Two rows that share a timestamp draw a vertical step,
   * which is how a one-time cost is shown.
   */
  rows: CostTimelineRow[];
  series: CostTimelineSeries[];
  regions?: CostTimelineRegion[];
  startMs: number;
  endMs: number;
  /** Position of the dashed inspection line. */
  cursorMs?: number | null;
  /** Called with the hovered or tapped timestamp. */
  onCursorChange?: (ms: number) => void;
  ariaLabel: string;
  className?: string;
}

const MONTH_MS = 30.44 * 86_400_000;

export function costTimelineTicks(startMs: number, endMs: number): number[] {
  const months = Math.max(1, (endMs - startMs) / MONTH_MS);
  const step = [1, 2, 3, 6, 12, 24].find((candidate) => months / candidate <= 7) ?? 24;
  const first = new Date(startMs);
  const ticks: number[] = [];
  let month = first.getUTCMonth() + (first.getUTCDate() > 1 ? 1 : 0);
  month = Math.ceil(month / step) * step;
  for (;;) {
    const tick = Date.UTC(first.getUTCFullYear(), month, 1);
    if (tick > endMs) break;
    ticks.push(tick);
    month += step;
  }
  return ticks;
}

function formatTickMonth(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function formatAxisUsd(value: number): string {
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

/**
 * Running cost balances for several series on a shared time axis. The chart
 * has no tooltip of its own: the caller renders the inspected values beside
 * it and drives the dashed cursor line.
 */
export function CostTimelineChart({
  rows,
  series,
  regions = [],
  startMs,
  endMs,
  cursorMs,
  onCursorChange,
  ariaLabel,
  className = 'h-[20rem] w-full sm:h-[24rem]',
}: CostTimelineChartProps) {
  const ticks = React.useMemo(() => costTimelineTicks(startMs, endMs), [startMs, endMs]);
  const ordered = React.useMemo(
    () => [...series].sort((a, b) => Number(Boolean(a.emphasized)) - Number(Boolean(b.emphasized))),
    [series],
  );

  const handleMove = (state: { activeLabel?: string | number | undefined } | null | undefined) => {
    const t = Number(state?.activeLabel);
    if (state?.activeLabel == null || !Number.isFinite(t)) return;
    onCursorChange?.(t);
  };

  return (
    <div className={className} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={CHART_MARGINS.withYAxis} onMouseMove={handleMove} onClick={handleMove}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          {regions.map((region) => (
            <ReferenceArea
              key={`${region.label}-${region.fromMs}`}
              x1={region.fromMs}
              x2={region.toMs}
              fill={CHART_COLORS.muted}
              fillOpacity={0.1}
              strokeOpacity={0}
              label={{ value: region.label, position: 'insideTopLeft', fill: TICK_STYLE.fill, fontSize: 11 }}
            />
          ))}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[startMs, endMs]}
            ticks={ticks}
            tickFormatter={(value: number) => formatTickMonth(value)}
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            width={52}
            domain={['auto', 'auto']}
            tickFormatter={formatAxisUsd}
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
          />
          {/* The caller's readout stands in for the tooltip; this keeps hover tracking on. */}
          <Tooltip content={() => null} cursor={false} />
          {cursorMs != null ? (
            <ReferenceLine x={cursorMs} stroke={CHART_COLORS.muted} strokeDasharray="4 4" />
          ) : null}
          {ordered.map((entry) => (
            <Line
              key={entry.id}
              dataKey={entry.id}
              name={entry.label}
              type="linear"
              stroke={entry.color}
              strokeWidth={entry.emphasized ? 3 : 1.75}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
