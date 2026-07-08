import * as React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { formatPressure } from '../lib/utils';
import { getActiveElapsedSFromChartState, type TripChartMouseState } from './TripChartSync';
import { createSampleDotRenderer, getVisibleSampleElapsedSet } from './TripChartRendering';

export interface TripTirePressurePoint {
  elapsed_s: number;
  tire_fl_psi: number | null;
  tire_fr_psi: number | null;
  tire_rl_psi: number | null;
  tire_rr_psi: number | null;
}

export interface TripTirePressureChartProps {
  data: TripTirePressurePoint[];
  loading?: boolean;
  height?: number;
  activeElapsedS?: number | null;
  onActiveElapsedSChange?: (value: number | null) => void;
}

function formatElapsed(seconds: number) {
  const min = Math.floor(seconds / 60);
  const sec = Math.max(0, Math.floor(seconds % 60));
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function TripTirePressureChart({
  data,
  loading = false,
  height = 240,
  activeElapsedS = null,
  onActiveElapsedSChange,
}: TripTirePressureChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        Loading tire pressure chart...
      </div>
    );
  }

  const hasAnyData = data.some(
    (point) => point.tire_fl_psi != null
      || point.tire_fr_psi != null
      || point.tire_rl_psi != null
      || point.tire_rr_psi != null,
  );
  if (!hasAnyData) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        No tire pressure data for this trip.
      </div>
    );
  }

  const measuredData = React.useMemo(
    () => data.filter((point) => point.tire_fl_psi != null || point.tire_fr_psi != null || point.tire_rl_psi != null || point.tire_rr_psi != null),
    [data],
  );
  const flDot = React.useMemo(
    () => createSampleDotRenderer(
      getVisibleSampleElapsedSet(data, (point) => point.tire_fl_psi != null),
      { r: 2, strokeWidth: 0, fill: CHART_COLORS.accent },
    ),
    [data],
  );
  const frDot = React.useMemo(
    () => createSampleDotRenderer(
      getVisibleSampleElapsedSet(data, (point) => point.tire_fr_psi != null),
      { r: 2, strokeWidth: 0, fill: CHART_COLORS.sky },
    ),
    [data],
  );
  const rlDot = React.useMemo(
    () => createSampleDotRenderer(
      getVisibleSampleElapsedSet(data, (point) => point.tire_rl_psi != null),
      { r: 2, strokeWidth: 0, fill: CHART_COLORS.success },
    ),
    [data],
  );
  const rrDot = React.useMemo(
    () => createSampleDotRenderer(
      getVisibleSampleElapsedSet(data, (point) => point.tire_rr_psi != null),
      { r: 2, strokeWidth: 0, fill: CHART_COLORS.warning },
    ),
    [data],
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        syncId="trip-timeline-sync"
        syncMethod="value"
        margin={CHART_MARGINS.withYAxis}
        onMouseMove={(state) => {
          const nextElapsed = getActiveElapsedSFromChartState<TripTirePressurePoint>(
            state as TripChartMouseState<TripTirePressurePoint>,
            measuredData,
            activeElapsedS,
          );
          onActiveElapsedSChange?.(nextElapsed);
        }}
        onMouseLeave={() => onActiveElapsedSChange?.(null)}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="elapsed_s"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatElapsed}
          minTickGap={45}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatPressure(value)}
          width={34}
        />
        <Tooltip
          content={<ChartTooltip
            labelFormatter={(value) => formatElapsed(Number(value))}
            formatter={(value, name) => {
              if (name === 'tire_fl_psi') return [formatPressure(Number(value)), 'Front Left'];
              if (name === 'tire_fr_psi') return [formatPressure(Number(value)), 'Front Right'];
              if (name === 'tire_rl_psi') return [formatPressure(Number(value)), 'Rear Left'];
              if (name === 'tire_rr_psi') return [formatPressure(Number(value)), 'Rear Right'];
              return [String(value), String(name)];
            }}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Legend
          verticalAlign="top"
          height={22}
          wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted, paddingTop: 8 }}
          iconType="line"
        />
        {activeElapsedS != null ? (
          <ReferenceLine x={activeElapsedS} stroke={CHART_COLORS.muted} strokeDasharray="4 4" />
        ) : null}
        <Line
          type="monotone"
          dataKey="tire_fl_psi"
          name="tire_fl_psi"
          stroke={CHART_COLORS.accent}
          strokeWidth={1.8}
          dot={flDot}
          activeDot={{ r: 3.8, strokeWidth: 2, stroke: 'var(--rm-bg)', fill: CHART_COLORS.accent }}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="tire_fr_psi"
          name="tire_fr_psi"
          stroke={CHART_COLORS.sky}
          strokeWidth={1.8}
          dot={frDot}
          activeDot={{ r: 3.8, strokeWidth: 2, stroke: 'var(--rm-bg)', fill: CHART_COLORS.sky }}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="tire_rl_psi"
          name="tire_rl_psi"
          stroke={CHART_COLORS.success}
          strokeWidth={1.8}
          dot={rlDot}
          activeDot={{ r: 3.8, strokeWidth: 2, stroke: 'var(--rm-bg)', fill: CHART_COLORS.success }}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="tire_rr_psi"
          name="tire_rr_psi"
          stroke={CHART_COLORS.warning}
          strokeWidth={1.8}
          dot={rrDot}
          activeDot={{ r: 3.8, strokeWidth: 2, stroke: 'var(--rm-bg)', fill: CHART_COLORS.warning }}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
